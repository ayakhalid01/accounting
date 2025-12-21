-- =====================================================
-- Migration 027: Waterfall Deposit Allocation (Day-by-Day)
-- =====================================================
-- Purpose: Allocate deposits to sales day-by-day using FIFO
-- Deposits fill gaps chronologically, oldest deposit first
-- =====================================================

-- 1. Add columns to deposits table
ALTER TABLE deposits 
ADD COLUMN IF NOT EXISTS gap_covered NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS gap_uncovered NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15, 2) DEFAULT 0.00;

-- 2. Initialize for existing deposits
UPDATE deposits 
SET 
  remaining_amount = net_amount,
  gap_covered = 0,
  gap_uncovered = 0
WHERE remaining_amount IS NULL;

-- 3. TRUE WATERFALL: Running balance using RECURSIVE CTE
CREATE OR REPLACE FUNCTION calculate_waterfall_allocation(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  allocation_date DATE,
  daily_sales NUMERIC,
  deposits_used NUMERIC,
  daily_gap NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH RECURSIVE
  -- Pre-aggregate invoices by day
  daily_invoices AS (
    SELECT 
      sale_order_date as day,
      SUM(amount_total) as total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date
  ),
  -- Pre-aggregate credits by day
  daily_credits AS (
    SELECT 
      sale_order_date as day,
      SUM(ABS(amount_total)) as total
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date
  ),
  -- Calculate daily net sales
  daily_sales_data AS (
    SELECT 
      d::DATE as day,
      ROW_NUMBER() OVER (ORDER BY d) as day_num,
      COALESCE(di.total, 0) - COALESCE(dc.total, 0) as sales
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d
    LEFT JOIN daily_invoices di ON di.day = d::DATE
    LEFT JOIN daily_credits dc ON dc.day = d::DATE
  ),
  -- Get approved deposits (FIFO order)
  deposits_list AS (
    SELECT 
      d.id,
      d.start_date,
      d.end_date,
      d.net_amount,
      ROW_NUMBER() OVER (ORDER BY d.start_date, d.created_at) as seq
    FROM deposits d
    WHERE d.status = 'approved'
      AND d.start_date <= p_end_date
      AND d.end_date >= p_start_date
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
  ),
  -- Recursive waterfall: track balance for each deposit
  waterfall AS (
    -- Base case: First day
    SELECT 
      dsd.day,
      dsd.day_num,
      dsd.sales,
      -- Initial balances: deposits start with full amount if active on first day
      (SELECT array_agg(
        CASE 
          WHEN dl.start_date <= dsd.day AND dl.end_date >= dsd.day 
          THEN dl.net_amount 
          ELSE 0 
        END ORDER BY dl.seq
      ) FROM deposits_list dl) as balances,
      -- Use deposits FIFO to cover sales
      LEAST(dsd.sales, 
        COALESCE((
          SELECT SUM(
            CASE 
              WHEN dl.start_date <= dsd.day AND dl.end_date >= dsd.day 
              THEN dl.net_amount 
              ELSE 0 
            END
          ) FROM deposits_list dl
        ), 0)
      ) as used
    FROM daily_sales_data dsd
    WHERE dsd.day_num = 1
    
    UNION ALL
    
    -- Recursive: Next days
    SELECT 
      dsd.day,
      dsd.day_num,
      dsd.sales,
      -- Update balances after consuming from previous day
      (SELECT array_agg(
        GREATEST(0,
          COALESCE(w.balances[dl.seq], 0) 
          - CASE 
              WHEN dl.start_date <= w.day AND dl.end_date >= w.day THEN
                LEAST(w.sales, COALESCE(w.balances[dl.seq], 0))
              ELSE 0
            END
          + CASE 
              WHEN dl.start_date = dsd.day THEN dl.net_amount
              ELSE 0
            END
        ) ORDER BY dl.seq
      ) FROM deposits_list dl) as balances,
      -- Use available balance to cover today's sales (FIFO)
      (
        WITH available AS (
          SELECT 
            dl.seq,
            GREATEST(0,
              COALESCE(w.balances[dl.seq], 0) 
              - CASE 
                  WHEN dl.start_date <= w.day AND dl.end_date >= w.day THEN
                    LEAST(w.sales, COALESCE(w.balances[dl.seq], 0))
                  ELSE 0
                END
              + CASE WHEN dl.start_date = dsd.day THEN dl.net_amount ELSE 0 END
            ) as bal,
            dl.start_date,
            dl.end_date
          FROM deposits_list dl
          WHERE dl.start_date <= dsd.day AND dl.end_date >= dsd.day
          ORDER BY dl.seq
        ),
        cumulative AS (
          SELECT 
            SUM(bal) OVER (ORDER BY seq) as running_total
          FROM available
        )
        SELECT LEAST(dsd.sales, COALESCE(MAX(running_total), 0))
        FROM cumulative
      ) as used
    FROM waterfall w
    JOIN daily_sales_data dsd ON dsd.day_num = w.day_num + 1
  )
  SELECT 
    day as allocation_date,
    sales as daily_sales,
    used as deposits_used,
    GREATEST(0, sales - used) as daily_gap
  FROM waterfall
  ORDER BY day;
$$;

GRANT EXECUTE ON FUNCTION calculate_waterfall_allocation(DATE, DATE, UUID) TO authenticated;

-- 4. Create simplified function to calculate gap in period (for trigger)
CREATE OR REPLACE FUNCTION calculate_gap_in_period(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL,
  p_exclude_deposit_id UUID DEFAULT NULL,
  p_use_latest BOOLEAN DEFAULT TRUE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_total_sales NUMERIC := 0;
  v_approved_deposits NUMERIC := 0;
  v_gap NUMERIC := 0;
BEGIN
  -- Calculate total sales (invoices - credits) in period
  SELECT 
    COALESCE(SUM(i.amount_total), 0) - COALESCE(SUM(c.credit_amount), 0)
  INTO v_total_sales
  FROM (
    SELECT COALESCE(SUM(amount_total), 0) as amount_total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  ) i,
  (
    SELECT COALESCE(SUM(ABS(amount_total)), 0) as credit_amount
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  ) c;

  -- Sum approved deposits overlapping the period (exclude optional deposit)
  SELECT COALESCE(SUM(d.net_amount), 0)
  INTO v_approved_deposits
  FROM deposits d
  WHERE d.status = 'approved'
    AND d.start_date <= p_end_date
    AND d.end_date >= p_start_date
    AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    AND (p_exclude_deposit_id IS NULL OR d.id != p_exclude_deposit_id);

  v_gap := GREATEST(0, v_total_sales - v_approved_deposits);

  RETURN v_gap;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID, BOOLEAN) TO authenticated;

-- 5. Create trigger function for deposit approval
CREATE OR REPLACE FUNCTION calculate_deposit_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_total_gap NUMERIC := 0;
  v_gap_covered NUMERIC := 0;
  v_gap_uncovered NUMERIC := 0;
BEGIN
  -- Only calculate when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    
    -- Calculate total gap in the deposit period
    v_total_gap := calculate_gap_in_period(
      NEW.start_date,
      NEW.end_date,
      NEW.payment_method_id,
      NEW.id,
      TRUE
    );
    
    -- How much can this deposit cover?
    v_gap_covered := LEAST(NEW.net_amount, v_total_gap);
    
    -- Gap uncovered = Total gap - what this deposit actually covered
    v_gap_uncovered := GREATEST(0, v_total_gap - v_gap_covered);
    
    -- Remaining = deposit amount - gap covered
    NEW.remaining_amount := GREATEST(0, NEW.net_amount - v_gap_covered);
    NEW.gap_covered := v_gap_covered;
    NEW.gap_uncovered := v_gap_uncovered;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- 6. Create trigger
DROP TRIGGER IF EXISTS trigger_calculate_deposit_allocation ON deposits;
CREATE TRIGGER trigger_calculate_deposit_allocation
  BEFORE UPDATE OF status ON deposits
  FOR EACH ROW
  EXECUTE FUNCTION calculate_deposit_allocation();

-- 7. SUPER FAST: Simple proportional allocation (no waterfall for performance)
-- For TRUE waterfall, use calculate_waterfall_allocation() separately for daily view
CREATE OR REPLACE FUNCTION get_monthly_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  period_month TEXT,
  period_start DATE,
  period_end DATE,
  total_invoices NUMERIC,
  total_credits NUMERIC,
  net_sales NUMERIC,
  approved_deposits NUMERIC,
  pending_deposits NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH months AS (
    SELECT 
      DATE_TRUNC('month', d)::DATE as month_start,
      (DATE_TRUNC('month', d) + INTERVAL '1 month - 1 day')::DATE as month_end
    FROM generate_series(
      DATE_TRUNC('month', p_start_date),
      DATE_TRUNC('month', p_end_date),
      INTERVAL '1 month'
    ) d
  ),
  invoice_agg AS (
    SELECT 
      DATE_TRUNC('month', sale_order_date)::DATE as month,
      SUM(amount_total) as total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', sale_order_date)
  ),
  credit_agg AS (
    SELECT 
      DATE_TRUNC('month', sale_order_date)::DATE as month,
      SUM(ABS(amount_total)) as total
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', sale_order_date)
  ),
  -- SIMPLE: Just sum approved deposits that overlap with each month
  deposit_agg AS (
    SELECT 
      m.month_start,
      SUM(CASE WHEN d.status = 'approved' THEN d.net_amount ELSE 0 END) as approved
    FROM months m
    LEFT JOIN deposits d ON 
      d.start_date <= m.month_end 
      AND d.end_date >= m.month_start
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY m.month_start
  ),
  pending_deposits AS (
    SELECT 
      m.month_start,
      SUM(CASE WHEN d.status = 'pending' THEN d.net_amount ELSE 0 END) as pending
    FROM months m
    LEFT JOIN deposits d ON 
      d.start_date <= m.month_end 
      AND d.end_date >= m.month_start
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY m.month_start
  )
  SELECT 
    TO_CHAR(m.month_start, 'Mon YYYY') as period_month,
    m.month_start as period_start,
    m.month_end as period_end,
    COALESCE(i.total, 0)::NUMERIC as total_invoices,
    COALESCE(c.total, 0)::NUMERIC as total_credits,
    (COALESCE(i.total, 0) - COALESCE(c.total, 0))::NUMERIC as net_sales,
    COALESCE(da.approved, 0)::NUMERIC as approved_deposits,
    COALESCE(pd.pending, 0)::NUMERIC as pending_deposits
  FROM months m
  LEFT JOIN invoice_agg i ON i.month = m.month_start
  LEFT JOIN credit_agg c ON c.month = m.month_start
  LEFT JOIN deposit_agg da ON da.month_start = m.month_start
  LEFT JOIN pending_deposits pd ON pd.month_start = m.month_start
  ORDER BY m.month_start;
$$;

GRANT EXECUTE ON FUNCTION get_monthly_aggregations(DATE, DATE, UUID) TO authenticated;

-- 8. Add comments
COMMENT ON COLUMN deposits.gap_covered IS 'Amount of gap this deposit covered (using waterfall allocation)';
COMMENT ON COLUMN deposits.gap_uncovered IS 'Remaining gap in period after this deposit (Total gap - deposit amount)';
COMMENT ON COLUMN deposits.remaining_amount IS 'Unused deposit amount (if deposit > gap)';

COMMENT ON FUNCTION calculate_waterfall_allocation IS 'Day-by-day waterfall allocation: deposits fill gaps chronologically using FIFO';
COMMENT ON FUNCTION calculate_gap_in_period IS 'Calculate total gap (Sales - Credits) in date range';
COMMENT ON FUNCTION calculate_deposit_allocation IS 'Trigger to calculate gap_covered, gap_uncovered, and remaining when deposit approved';

-- =====================================================
-- How it works:
-- =====================================================
-- 1. When deposit approved: Calculate gap in period, set gap_covered/uncovered/remaining
-- 2. Dashboard uses calculate_waterfall_allocation() for day-by-day FIFO allocation
-- 3. Deposits fill gaps chronologically, oldest deposit first
-- 4. Monthly aggregations sum daily waterfall results
-- =====================================================

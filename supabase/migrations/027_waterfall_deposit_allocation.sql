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

-- 3. Create function for day-by-day waterfall allocation (SIMPLE & CORRECT)
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
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current_date DATE;
  v_sales NUMERIC;
  v_deposits_total NUMERIC;
  v_used NUMERIC;
  v_gap NUMERIC;
  v_deposit RECORD;
  v_to_use NUMERIC;
BEGIN
  -- Create temp table to track deposit balances
  CREATE TEMP TABLE IF NOT EXISTS deposit_tracker (
    deposit_id UUID PRIMARY KEY,
    remaining NUMERIC
  ) ON COMMIT DROP;
  
  -- Initialize all approved deposits with their full amounts
  INSERT INTO deposit_tracker (deposit_id, remaining)
  SELECT 
    d.id,
    d.net_amount
  FROM deposits d
  WHERE d.status = 'approved'
    AND d.start_date <= p_end_date
    AND d.end_date >= p_start_date
    AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
  ON CONFLICT (deposit_id) DO NOTHING;
  
  -- Loop through each day
  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    
    -- Calculate daily sales (invoices - credits)
    SELECT 
      COALESCE(SUM(i.amount_total), 0) - COALESCE(SUM(c.amount_total), 0)
    INTO v_sales
    FROM (
      SELECT COALESCE(SUM(amount_total), 0) as amount_total
      FROM invoices
      WHERE state = 'posted'
        AND sale_order_date = v_current_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    ) i,
    (
      SELECT COALESCE(SUM(ABS(amount_total)), 0) as amount_total
      FROM credit_notes
      WHERE state = 'posted'
        AND original_invoice_id IS NOT NULL
        AND sale_order_date = v_current_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    ) c;
    
    v_used := 0;
    v_deposits_total := v_sales; -- Remaining to cover
    
    -- Use deposits in FIFO order (oldest first)
    FOR v_deposit IN 
      SELECT 
        dt.deposit_id,
        dt.remaining,
        d.start_date,
        d.end_date
      FROM deposit_tracker dt
      JOIN deposits d ON d.id = dt.deposit_id
      WHERE dt.remaining > 0
        AND d.start_date <= v_current_date
        AND d.end_date >= v_current_date
      ORDER BY d.start_date, d.created_at
    LOOP
      -- How much can we use from this deposit?
      v_to_use := LEAST(v_deposit.remaining, v_deposits_total);
      
      IF v_to_use > 0 THEN
        -- Use it
        v_used := v_used + v_to_use;
        v_deposits_total := v_deposits_total - v_to_use;
        
        -- Update balance
        UPDATE deposit_tracker
        SET remaining = remaining - v_to_use
        WHERE deposit_id = v_deposit.deposit_id;
      END IF;
      
      -- Stop if we covered all sales
      EXIT WHEN v_deposits_total <= 0;
    END LOOP;
    
    v_gap := GREATEST(0, v_sales - v_used);
    
    -- Return this day's result
    RETURN QUERY SELECT 
      v_current_date,
      v_sales,
      v_used,
      v_gap;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_waterfall_allocation(DATE, DATE, UUID) TO authenticated;

-- 4. Create simplified function to calculate gap in period (for trigger)
CREATE OR REPLACE FUNCTION calculate_gap_in_period(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL,
  p_exclude_deposit_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_total_sales NUMERIC := 0;
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
  
  RETURN GREATEST(0, v_total_sales);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) TO authenticated;

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
      NEW.id
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

-- 7. Update monthly aggregations to use waterfall
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
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
BEGIN
  RETURN QUERY
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
  -- Use waterfall allocation for deposits
  waterfall_deposits AS (
    SELECT 
      DATE_TRUNC('month', allocation_date)::DATE as month,
      SUM(deposits_used) as approved
    FROM calculate_waterfall_allocation(p_start_date, p_end_date, p_payment_method_id)
    GROUP BY DATE_TRUNC('month', allocation_date)
  ),
  pending_deposits AS (
    SELECT 
      m.month_start,
      SUM(CASE WHEN d.status = 'pending' THEN d.net_amount ELSE 0 END) as pending
    FROM months m
    LEFT JOIN deposits d ON d.start_date <= m.month_end AND d.end_date >= m.month_start
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
    COALESCE(wd.approved, 0)::NUMERIC as approved_deposits,
    COALESCE(pd.pending, 0)::NUMERIC as pending_deposits
  FROM months m
  LEFT JOIN invoice_agg i ON i.month = m.month_start
  LEFT JOIN credit_agg c ON c.month = m.month_start
  LEFT JOIN waterfall_deposits wd ON wd.month = m.month_start
  LEFT JOIN pending_deposits pd ON pd.month_start = m.month_start
  ORDER BY m.month_start;
END;
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

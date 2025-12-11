-- =====================================================
-- Migration 029: Populate Deposit Allocations Function
-- =====================================================
-- Purpose: Calculate day-by-day FIFO waterfall allocation
-- Strategy: Use procedural PL/pgSQL with step-by-step calculation
-- =====================================================

-- 1. Function to populate allocations for a single deposit
CREATE OR REPLACE FUNCTION populate_deposit_allocations(p_deposit_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_deposit RECORD;
  v_day DATE;
  v_daily_sales NUMERIC;
  v_deposit_balance NUMERIC;
  v_allocated NUMERIC;
  v_gap NUMERIC;
  v_older_deposits_used NUMERIC;
  v_remaining_gap NUMERIC;
  v_day_record RECORD;
BEGIN
  -- Get deposit details including created_at for FIFO comparison
  SELECT 
    id, start_date, end_date, net_amount, payment_method_id, status, created_at
  INTO v_deposit
  FROM deposits
  WHERE id = p_deposit_id;

  -- Only process approved deposits
  IF v_deposit.status != 'approved' THEN
    RAISE NOTICE 'Deposit % is not approved, skipping allocation', p_deposit_id;
    RETURN;
  END IF;

  -- Delete existing allocations for this deposit
  DELETE FROM deposit_allocations WHERE deposit_id = p_deposit_id;

  -- Initialize deposit balance
  v_deposit_balance := v_deposit.net_amount;

  -- OPTIMIZATION: Pre-calculate all daily sales and older allocations in one query
  FOR v_day_record IN
    WITH date_series AS (
      SELECT d::DATE as day
      FROM generate_series(v_deposit.start_date, v_deposit.end_date, '1 day'::interval) d
    ),
    daily_invoices AS (
      SELECT 
        sale_order_date::DATE as day,
        SUM(amount_total) as total
      FROM invoices
      WHERE state = 'posted'
        AND sale_order_date::DATE BETWEEN v_deposit.start_date AND v_deposit.end_date
        AND payment_method_id = v_deposit.payment_method_id
      GROUP BY sale_order_date::DATE
    ),
    daily_credits AS (
      SELECT 
        sale_order_date::DATE as day,
        SUM(ABS(amount_total)) as total
      FROM credit_notes
      WHERE state = 'posted'
        AND original_invoice_id IS NOT NULL
        AND sale_order_date::DATE BETWEEN v_deposit.start_date AND v_deposit.end_date
        AND payment_method_id = v_deposit.payment_method_id
      GROUP BY sale_order_date::DATE
    ),
    older_allocations AS (
      SELECT 
        da.allocation_date as day,
        SUM(da.allocated_amount) as allocated
      FROM deposit_allocations da
      JOIN deposits d ON d.id = da.deposit_id
      WHERE da.allocation_date BETWEEN v_deposit.start_date AND v_deposit.end_date
        AND d.status = 'approved'
        AND d.id != p_deposit_id
        AND (d.start_date < v_deposit.start_date OR (d.start_date = v_deposit.start_date AND d.created_at < v_deposit.created_at))
        AND da.payment_method_id = v_deposit.payment_method_id
      GROUP BY da.allocation_date
    )
    SELECT 
      ds.day,
      COALESCE(di.total, 0) - COALESCE(dc.total, 0) as sales,
      COALESCE(oa.allocated, 0) as older_allocated
    FROM date_series ds
    LEFT JOIN daily_invoices di ON di.day = ds.day
    LEFT JOIN daily_credits dc ON dc.day = ds.day
    LEFT JOIN older_allocations oa ON oa.day = ds.day
    ORDER BY ds.day
  LOOP
    v_day := v_day_record.day;
    v_daily_sales := v_day_record.sales;
    v_older_deposits_used := v_day_record.older_allocated;

    -- Calculate remaining gap after older deposits
    v_remaining_gap := GREATEST(0, v_daily_sales - v_older_deposits_used);
    
    -- This deposit covers as much of the remaining gap as possible
    v_allocated := LEAST(v_deposit_balance, v_remaining_gap);
    v_gap := GREATEST(0, v_remaining_gap - v_allocated);

    -- Insert allocation record
    INSERT INTO deposit_allocations (
      deposit_id,
      allocation_date,
      payment_method_id,
      daily_sales,
      allocated_amount,
      daily_gap,
      deposit_balance_start,
      deposit_balance_end
    ) VALUES (
      p_deposit_id,
      v_day,
      v_deposit.payment_method_id,
      v_daily_sales,
      v_allocated,
      v_gap,
      v_deposit_balance,
      v_deposit_balance - v_allocated
    );

    -- Update running balance
    v_deposit_balance := v_deposit_balance - v_allocated;
  END LOOP;

  -- Update deposit summary columns
  UPDATE deposits
  SET 
    gap_covered = (
      SELECT COALESCE(SUM(allocated_amount), 0)
      FROM deposit_allocations
      WHERE deposit_id = p_deposit_id
    ),
    gap_uncovered = (
      SELECT COALESCE(SUM(daily_gap), 0)
      FROM deposit_allocations
      WHERE deposit_id = p_deposit_id
    ),
    remaining_amount = v_deposit_balance
  WHERE id = p_deposit_id;

  RAISE NOTICE 'Populated allocations for deposit %', p_deposit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION populate_deposit_allocations(UUID) TO authenticated;

-- 2. Function to recalculate ALL deposit allocations (useful for data fixes)
CREATE OR REPLACE FUNCTION recalculate_all_deposit_allocations()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_deposit_id UUID;
BEGIN
  -- Clear all allocations
  DELETE FROM deposit_allocations;

  -- Recalculate for all approved deposits in FIFO order
  FOR v_deposit_id IN 
    SELECT id 
    FROM deposits 
    WHERE status = 'approved'
    ORDER BY start_date, created_at
  LOOP
    PERFORM populate_deposit_allocations(v_deposit_id);
  END LOOP;

  RAISE NOTICE 'Recalculated all deposit allocations';
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_all_deposit_allocations() TO authenticated;

-- 3. Function to get daily aggregations for dashboard
-- IMPORTANT: Uses pre-calculated sales from deposit_allocations for consistency
CREATE OR REPLACE FUNCTION get_daily_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  allocation_date DATE,
  daily_sales NUMERIC,
  approved_deposits NUMERIC,
  pending_deposits NUMERIC,
  daily_gap NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH date_series AS (
    SELECT d::DATE as day
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d
  ),
  -- Use pre-calculated sales from deposit_allocations (already computed correctly)
  daily_sales_data AS (
    SELECT 
      da.allocation_date as day,
      MAX(da.daily_sales) as sales  -- MAX because same day might have multiple deposits, but daily_sales is same
    FROM deposit_allocations da
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
  ),
  daily_approved AS (
    SELECT 
      da.allocation_date as day,
      SUM(da.allocated_amount) as approved
    FROM deposit_allocations da
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
  ),
  daily_pending AS (
    SELECT 
      ds.day,
      COALESCE(SUM(d.net_amount / (d.end_date - d.start_date + 1)), 0) as pending
    FROM date_series ds
    LEFT JOIN deposits d ON ds.day BETWEEN d.start_date AND d.end_date
      AND d.status = 'pending'
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY ds.day
  )
  SELECT 
    ds.day as allocation_date,
    COALESCE(dsd.sales, 0) as daily_sales,
    COALESCE(dap.approved, 0) as approved_deposits,
    COALESCE(dpe.pending, 0) as pending_deposits,
    GREATEST(0, COALESCE(dsd.sales, 0) - COALESCE(dap.approved, 0)) as daily_gap
  FROM date_series ds
  LEFT JOIN daily_sales_data dsd ON dsd.day = ds.day
  LEFT JOIN daily_approved dap ON dap.day = ds.day
  LEFT JOIN daily_pending dpe ON dpe.day = ds.day
  ORDER BY ds.day;
$$;

GRANT EXECUTE ON FUNCTION get_daily_aggregations(DATE, DATE, UUID) TO authenticated;

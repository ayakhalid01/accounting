-- =====================================================
-- Migration 039: Refresh All Allocations Function
-- =====================================================
-- Purpose: Recalculate all deposit allocations when invoices change
-- Trigger: Manual button click or automatic on invoice/credit changes
-- =====================================================

-- 1. Function to refresh ALL deposit allocations
CREATE OR REPLACE FUNCTION refresh_all_deposit_allocations()
RETURNS TABLE (
  total_deposits_processed INT,
  total_days_allocated INT,
  total_gap_covered NUMERIC,
  total_gap_uncovered NUMERIC,
  processing_time_seconds NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_start_time TIMESTAMP;
  v_deposit_count INT := 0;
  v_day_count INT := 0;
  v_total_covered NUMERIC := 0;
  v_total_uncovered NUMERIC := 0;
  v_deposit_id UUID;
BEGIN
  v_start_time := NOW();
  
  -- Clear all existing allocations (need WHERE clause for RLS)
  DELETE FROM deposit_allocations WHERE TRUE;
  
  -- Get all approved deposits and recalculate allocations for each
  FOR v_deposit_id IN
    SELECT id FROM deposits 
    WHERE status = 'approved'
    ORDER BY start_date ASC, created_at ASC
  LOOP
    -- Call the existing populate function for each deposit
    PERFORM populate_deposit_allocations(v_deposit_id);
    v_deposit_count := v_deposit_count + 1;
  END LOOP;
  
  -- Aggregate the results
  SELECT 
    COUNT(*),
    COALESCE(SUM(allocated_amount), 0),
    COALESCE(SUM(daily_gap), 0)
  INTO v_day_count, v_total_covered, v_total_uncovered
  FROM deposit_allocations;
  
  RETURN QUERY SELECT 
    v_deposit_count,
    v_day_count,
    v_total_covered,
    v_total_uncovered,
    EXTRACT(EPOCH FROM (NOW() - v_start_time))::NUMERIC;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_all_deposit_allocations() TO authenticated;

-- 2. Trigger function to refresh allocations when invoices change
CREATE OR REPLACE FUNCTION trigger_refresh_allocations()
RETURNS TRIGGER AS $$
BEGIN
  -- Queue a background job to refresh allocations
  -- For now, we'll just log it - the frontend will trigger the refresh
  RAISE NOTICE 'Invoice/Credit changed - allocations need refresh for date %', 
    COALESCE(NEW.sale_order_date, OLD.sale_order_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger on invoices table
DROP TRIGGER IF EXISTS trg_invoice_allocation_refresh ON invoices;
CREATE TRIGGER trg_invoice_allocation_refresh
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_refresh_allocations();

-- 4. Trigger on credit_notes table
DROP TRIGGER IF EXISTS trg_credit_allocation_refresh ON credit_notes;
CREATE TRIGGER trg_credit_allocation_refresh
  AFTER INSERT OR UPDATE OR DELETE ON credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION trigger_refresh_allocations();

-- 5. Function to refresh allocations for a specific date range
CREATE OR REPLACE FUNCTION refresh_allocations_for_date_range(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  total_deposits_processed INT,
  total_days_allocated INT,
  total_gap_covered NUMERIC,
  total_gap_uncovered NUMERIC,
  processing_time_seconds NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_start_time TIMESTAMP;
  v_deposit_count INT := 0;
  v_day_count INT := 0;
  v_total_covered NUMERIC := 0;
  v_total_uncovered NUMERIC := 0;
  v_deposit_id UUID;
BEGIN
  v_start_time := NOW();
  
  -- Get all approved deposits that overlap with date range
  FOR v_deposit_id IN
    SELECT id FROM deposits 
    WHERE status = 'approved'
      AND start_date <= p_end_date
      AND end_date >= p_start_date
    ORDER BY start_date ASC, created_at ASC
  LOOP
    -- Delete allocations for this deposit in the range
    DELETE FROM deposit_allocations 
    WHERE deposit_id = v_deposit_id
      AND allocation_date BETWEEN p_start_date AND p_end_date;
    
    -- Recalculate allocations for this deposit
    PERFORM populate_deposit_allocations(v_deposit_id);
    v_deposit_count := v_deposit_count + 1;
  END LOOP;
  
  -- Aggregate results
  SELECT 
    COUNT(*),
    COALESCE(SUM(allocated_amount), 0),
    COALESCE(SUM(daily_gap), 0)
  INTO v_day_count, v_total_covered, v_total_uncovered
  FROM deposit_allocations
  WHERE allocation_date BETWEEN p_start_date AND p_end_date;
  
  RETURN QUERY SELECT 
    v_deposit_count,
    v_day_count,
    v_total_covered,
    v_total_uncovered,
    EXTRACT(EPOCH FROM (NOW() - v_start_time))::NUMERIC;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_allocations_for_date_range(DATE, DATE) TO authenticated;

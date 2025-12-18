-- 042_add_gap_logging_and_clear_function.sql
-- Add a logging table for gap calculations and a function to clear deposit_allocations for a period/method

-- 1. Create logging table
CREATE TABLE IF NOT EXISTS deposit_gap_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  start_date date not null,
  end_date date not null,
  payment_method_id uuid null,
  exclude_deposit_id uuid null,
  source text not null,
  gap_value numeric(15,2) not null
);

CREATE INDEX IF NOT EXISTS idx_deposit_gap_logs_date ON deposit_gap_logs USING btree (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_deposit_gap_logs_method ON deposit_gap_logs USING btree (payment_method_id);

-- 2. Replace calculate_gap_in_period to write a log row for each calculation
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
  v_alloc_count INT := 0;
  v_alloc_gap NUMERIC := 0;
  v_total_sales NUMERIC := 0;
  v_result NUMERIC := 0;
BEGIN
  -- Check if there are deposit_allocations rows for the given period and payment method
  SELECT COUNT(*) INTO v_alloc_count
  FROM deposit_allocations
  WHERE allocation_date BETWEEN p_start_date AND p_end_date
    AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    AND (p_exclude_deposit_id IS NULL OR deposit_id IS DISTINCT FROM p_exclude_deposit_id);

  IF v_alloc_count > 0 THEN
    -- Sum daily_gap from deposit_allocations
    SELECT COALESCE(SUM(daily_gap), 0) INTO v_alloc_gap
    FROM deposit_allocations
    WHERE allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
      AND (p_exclude_deposit_id IS NULL OR deposit_id IS DISTINCT FROM p_exclude_deposit_id);

    v_result := GREATEST(0, v_alloc_gap);

    -- Insert a log row
    INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
    VALUES (p_start_date, p_end_date, p_payment_method_id, p_exclude_deposit_id, 'allocations', v_result);

    RETURN v_result;
  END IF;

  -- Fallback to previous sales-based calculation
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

  v_result := GREATEST(0, v_total_sales);

  INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
  VALUES (p_start_date, p_end_date, p_payment_method_id, p_exclude_deposit_id, 'sales', v_result);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) TO authenticated;
COMMENT ON FUNCTION calculate_gap_in_period IS 'Calculate total gap in date range. Prefer sum(daily_gap) from deposit_allocations when rows exist; log source and value to deposit_gap_logs.';

-- 3. Add function to clear deposit_allocations for a period/method (admin use)
CREATE OR REPLACE FUNCTION clear_deposit_allocations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM deposit_allocations
  WHERE allocation_date BETWEEN p_start_date AND p_end_date
    AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  RETURNING 1 INTO v_deleted;

  -- The above RETURNING only stores a single value; better to count
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_deposit_allocations(DATE, DATE, UUID) TO authenticated;
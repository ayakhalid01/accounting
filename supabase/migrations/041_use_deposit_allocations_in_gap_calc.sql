-- 041_use_deposit_allocations_in_gap_calc.sql
-- Prefer deposit_allocations.daily_gap when available, otherwise fallback to previous sales-based calculation

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

    -- Return the aggregated gap available according to deposit_allocations
    RETURN GREATEST(0, v_alloc_gap);
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

  RETURN GREATEST(0, v_total_sales);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) TO authenticated;
COMMENT ON FUNCTION calculate_gap_in_period IS 'Calculate total gap in date range. Prefer sum(daily_gap) from deposit_allocations when rows exist, otherwise fallback to sales-minus-credits calculation.';

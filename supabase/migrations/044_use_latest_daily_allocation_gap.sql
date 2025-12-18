-- 044_use_latest_daily_allocation_gap.sql
-- Use latest daily allocation per day+method when computing gap (DISTINCT ON by created_at DESC)
-- Adds optional parameter p_use_latest BOOLEAN DEFAULT TRUE to toggle behavior

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
  v_alloc_count INT := 0;
  v_alloc_gap NUMERIC := 0;
  v_total_sales NUMERIC := 0;
  v_result NUMERIC := 0;
BEGIN
  -- If requested, compute per-day values: for each day in the range use MIN(daily_gap) for that day+method if present, otherwise use that day's net sales; then sum across days
  IF p_use_latest THEN
    -- For each day, choose min(daily_gap) if allocations exist for that day, else use that day's sales (invoices - credits)
    SELECT COALESCE(SUM(CASE WHEN a.min_daily IS NOT NULL THEN a.min_daily ELSE (COALESCE(s.invoices, 0) - COALESCE(c.credits, 0)) END), 0)
    INTO v_alloc_gap
    FROM (
      SELECT d::DATE AS day
      FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d
    ) days
    LEFT JOIN (
      SELECT allocation_date AS day, MIN(daily_gap) AS min_daily
      FROM deposit_allocations
      WHERE allocation_date BETWEEN p_start_date AND p_end_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        AND (p_exclude_deposit_id IS NULL OR deposit_id IS DISTINCT FROM p_exclude_deposit_id)
      GROUP BY allocation_date
    ) a ON a.day = days.day
    LEFT JOIN (
      SELECT sale_order_date::DATE AS day, COALESCE(SUM(amount_total), 0) AS invoices
      FROM invoices
      WHERE state = 'posted'
        AND sale_order_date::DATE BETWEEN p_start_date AND p_end_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
      GROUP BY sale_order_date::DATE
    ) s ON s.day = days.day
    LEFT JOIN (
      SELECT sale_order_date::DATE AS day, COALESCE(SUM(ABS(amount_total)), 0) AS credits
      FROM credit_notes
      WHERE state = 'posted'
        AND original_invoice_id IS NOT NULL
        AND sale_order_date::DATE BETWEEN p_start_date AND p_end_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
      GROUP BY sale_order_date::DATE
    ) c ON c.day = days.day;

    v_result := GREATEST(0, v_alloc_gap);

    INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
    VALUES (p_start_date, p_end_date, p_payment_method_id, p_exclude_deposit_id, 'allocations_grouped_perday', v_result);

    RETURN v_result;
  ELSE
    -- old allocations aggregation (sum all rows)
    SELECT COUNT(*) INTO v_alloc_count
    FROM deposit_allocations
    WHERE allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
      AND (p_exclude_deposit_id IS NULL OR deposit_id IS DISTINCT FROM p_exclude_deposit_id);

    IF v_alloc_count > 0 THEN
      SELECT COALESCE(SUM(daily_gap), 0) INTO v_alloc_gap
      FROM deposit_allocations
      WHERE allocation_date BETWEEN p_start_date AND p_end_date
        AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        AND (p_exclude_deposit_id IS NULL OR deposit_id IS DISTINCT FROM p_exclude_deposit_id);

      v_result := GREATEST(0, v_alloc_gap);

      INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
      VALUES (p_start_date, p_end_date, p_payment_method_id, p_exclude_deposit_id, 'allocations_sum', v_result);

      RETURN v_result;
    END IF;
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

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID, BOOLEAN) TO authenticated;
COMMENT ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID, BOOLEAN) IS 'Calculate total gap in date range. When p_use_latest=true compute per-day value: use MIN(daily_gap) for day+method when present else use that day''s net sales; sum across days (source=allocations_grouped_perday).';

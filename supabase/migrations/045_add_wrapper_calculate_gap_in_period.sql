-- 045_add_wrapper_calculate_gap_in_period.sql
-- Add a 4-argument wrapper that delegates to 5-argument calculate_gap_in_period(..., p_use_latest := true)
-- Note: p_use_latest = true uses per-day+method grouped "min-zero" allocation logic implemented in migration 044

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
BEGIN
  -- Delegate to the 5-argument implementation with p_use_latest = true (prefer per-day+method grouped min-zero allocations)
  RETURN calculate_gap_in_period(p_start_date, p_end_date, p_payment_method_id, p_exclude_deposit_id, true);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) TO authenticated;
COMMENT ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) IS 'Compatibility wrapper: delegates to calculate_gap_in_period(..., p_use_latest := true) which uses per-day grouped logic: per day use MIN(daily_gap) if allocations exist else use that day''s net sales (migration 044)';

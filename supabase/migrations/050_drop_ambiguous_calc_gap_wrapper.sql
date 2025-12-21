-- 050_drop_ambiguous_calc_gap_wrapper.sql
-- Fix: remove 4-arg wrapper for calculate_gap_in_period which causes ambiguity
-- The 5-argument implementation (with default p_use_latest) already supports 4-arg calls via default parameter.

-- Drop the 4-argument wrapper to avoid "function ... is not unique" runtime errors
DROP FUNCTION IF EXISTS calculate_gap_in_period(DATE, DATE, UUID, UUID);

-- Confirm the 5-argument implementation exists (no-op if already present)
-- If needed, you can re-create the 5-arg implementation from migration 044.

COMMENT ON FUNCTION calculate_gap_in_period(DATE, DATE, UUID, UUID) IS 'Dropped to avoid ambiguity with 5-arg implementation (migration 044).';

-- 046_update_deposit_allocations_unique_constraint.sql
-- Change uniqueness constraint to include payment_method_id so multiple per-day rows per deposit (different methods) are allowed.

ALTER TABLE deposit_allocations
  DROP CONSTRAINT IF EXISTS unique_deposit_date;

-- Add new unique constraint including payment_method_id
ALTER TABLE deposit_allocations
  ADD CONSTRAINT unique_deposit_date_method UNIQUE (deposit_id, allocation_date, payment_method_id);

-- Add explanatory comment
COMMENT ON CONSTRAINT unique_deposit_date_method ON deposit_allocations IS 'Unique per deposit + allocation_date + payment_method_id to allow multiple method rows per day when using method_group.';

-- Add index to help lookups by deposit and method
CREATE INDEX IF NOT EXISTS idx_deposit_allocations_deposit_date_method
  ON deposit_allocations(deposit_id, allocation_date, payment_method_id);

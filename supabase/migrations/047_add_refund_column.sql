-- 047_add_refund_column.sql
-- Add canonical refund_column and copy existing values from refund_column_name for compatibility

ALTER TABLE payment_method_deposit_settings
ADD COLUMN IF NOT EXISTS refund_column TEXT;

-- Populate canonical column from legacy column values where present
UPDATE payment_method_deposit_settings
SET refund_column = refund_column_name
WHERE refund_column IS NULL AND refund_column_name IS NOT NULL;

COMMENT ON COLUMN payment_method_deposit_settings.refund_column IS 'Canonical refund column (kept for compatibility with newer code). Values copied from refund_column_name where present.';

-- Grant permissions if needed (keep consistent with other columns)
GRANT SELECT, UPDATE ON payment_method_deposit_settings(refund_column) TO authenticated;
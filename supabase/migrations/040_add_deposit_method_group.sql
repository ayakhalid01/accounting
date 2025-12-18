-- 040_add_deposit_method_group.sql
-- Add support for ordered method groups on deposits

ALTER TABLE IF EXISTS deposits
ADD COLUMN IF NOT EXISTS method_group jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN deposits.method_group IS 'Ordered array of payment methods for this deposit (first is base method). Format: [{payment_method_id, name_en}, ...]';

-- =====================================================
-- Migration 037: Make sale_order_date nullable
-- =====================================================
-- Purpose: Allow invoices and credit notes to be uploaded without a sales date
-- Changes: sale_order_date can now be NULL if not provided in Excel upload
-- =====================================================

-- =====================================================
-- 1. Make invoices.sale_order_date nullable
-- =====================================================
ALTER TABLE invoices 
  ALTER COLUMN sale_order_date DROP NOT NULL;

-- =====================================================
-- 2. Make credit_notes.sale_order_date nullable
-- =====================================================
ALTER TABLE credit_notes 
  ALTER COLUMN sale_order_date DROP NOT NULL;

-- =====================================================
-- 3. Add comment explaining the change
-- =====================================================
COMMENT ON COLUMN invoices.sale_order_date IS 'Sales order date - nullable to allow uploads without this date, can be updated later';
COMMENT ON COLUMN credit_notes.sale_order_date IS 'Sales order date - nullable to allow uploads without this date, can be updated later';

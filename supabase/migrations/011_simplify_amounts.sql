-- Migration 011: Simplify amount columns and fix dates
-- Remove amount_untaxed and amount_tax, keep only amount_total
-- Use sale_order_date as primary date for both invoices and credit_notes

-- ==================== Drop Dependent Views First ====================

DROP VIEW IF EXISTS net_sales_view CASCADE;
DROP VIEW IF EXISTS dashboard_summary CASCADE;

-- ==================== Update Invoices Table ====================

-- Drop amount_untaxed and amount_tax if they exist
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'amount_untaxed'
  ) THEN
    ALTER TABLE invoices DROP COLUMN amount_untaxed CASCADE;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'amount_tax'
  ) THEN
    ALTER TABLE invoices DROP COLUMN amount_tax CASCADE;
  END IF;
END $$;

-- Make sure amount_total is NOT NULL
ALTER TABLE invoices ALTER COLUMN amount_total SET NOT NULL;

-- Make invoice_date optional (since we use sale_order_date)
ALTER TABLE invoices ALTER COLUMN invoice_date DROP NOT NULL;

-- ==================== Update Credit Notes Table ====================

-- Drop amount_untaxed and amount_tax if they exist
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'credit_notes' AND column_name = 'amount_untaxed'
  ) THEN
    ALTER TABLE credit_notes DROP COLUMN amount_untaxed CASCADE;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'credit_notes' AND column_name = 'amount_tax'
  ) THEN
    ALTER TABLE credit_notes DROP COLUMN amount_tax CASCADE;
  END IF;
END $$;

-- Make sure amount_total is NOT NULL
ALTER TABLE credit_notes ALTER COLUMN amount_total SET NOT NULL;

-- Make credit_date optional (since we use sale_order_date)
ALTER TABLE credit_notes ALTER COLUMN credit_date DROP NOT NULL;

-- ==================== Recreate Net Sales View ====================

CREATE VIEW net_sales_view AS
SELECT
  i.id,
  i.invoice_number,
  i.sale_order_date,
  i.partner_name,
  i.amount_total as invoice_amount,
  COALESCE(SUM(cn.amount_total), 0) as credit_notes_amount,
  (i.amount_total - COALESCE(SUM(cn.amount_total), 0)) as net_amount,
  i.payment_method_id,
  pm.name_en as payment_method_name,
  i.state
FROM invoices i
LEFT JOIN credit_notes cn ON cn.original_invoice_id = i.id AND cn.state = 'posted'
LEFT JOIN payment_methods pm ON i.payment_method_id = pm.id
WHERE i.state = 'posted'
GROUP BY i.id, i.invoice_number, i.sale_order_date, i.partner_name, i.amount_total, i.payment_method_id, pm.name_en, i.state;

-- ==================== Recreate Dashboard Summary View ====================

CREATE VIEW dashboard_summary AS
SELECT
  COALESCE(SUM(CASE WHEN i.state = 'posted' THEN i.amount_total ELSE 0 END), 0) as total_sales,
  COALESCE(SUM(CASE WHEN cn.state = 'posted' THEN cn.amount_total ELSE 0 END), 0) as total_credits,
  COALESCE(SUM(CASE WHEN i.state = 'posted' THEN i.amount_total ELSE 0 END), 0) - 
    COALESCE(SUM(CASE WHEN cn.state = 'posted' THEN cn.amount_total ELSE 0 END), 0) as net_sales,
  0 as total_deductions,
  COALESCE(SUM(CASE WHEN i.state = 'posted' THEN i.amount_total ELSE 0 END), 0) - 
    COALESCE(SUM(CASE WHEN cn.state = 'posted' THEN cn.amount_total ELSE 0 END), 0) as net_after_deduction,
  0 as pending_count
FROM invoices i
FULL OUTER JOIN credit_notes cn ON true;

-- ==================== Create Upload History Table ====================

CREATE TABLE IF NOT EXISTS upload_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  import_type TEXT NOT NULL CHECK (import_type IN ('invoices', 'credits')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_upload_history_type ON upload_history(import_type);
CREATE INDEX idx_upload_history_date ON upload_history(created_at);
CREATE INDEX idx_upload_history_user ON upload_history(uploaded_by);

COMMENT ON TABLE upload_history IS 'Tracks all file uploads for invoices and credit notes';

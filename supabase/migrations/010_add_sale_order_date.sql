-- Add sale_order_date column to invoices and credit_notes
-- Migration: 010_add_sale_order_date
-- Created: 2025-12-09
-- Description: Add sale_order_date column and update views to use it instead of invoice_date

-- Add sale_order_date to invoices (only if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'sale_order_date'
  ) THEN
    ALTER TABLE invoices ADD COLUMN sale_order_date TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Add sale_order_date to credit_notes (only if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'credit_notes' AND column_name = 'sale_order_date'
  ) THEN
    ALTER TABLE credit_notes ADD COLUMN sale_order_date TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Update existing records to use invoice_date/credit_date as sale_order_date if null
UPDATE invoices 
SET sale_order_date = invoice_date 
WHERE sale_order_date IS NULL;

UPDATE credit_notes 
SET sale_order_date = credit_date 
WHERE sale_order_date IS NULL;

-- Make sale_order_date NOT NULL after populating (only if column exists and has data)
DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'sale_order_date'
  ) THEN
    -- Only set NOT NULL if all rows have a value
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE sale_order_date IS NULL) THEN
      ALTER TABLE invoices ALTER COLUMN sale_order_date SET NOT NULL;
    END IF;
  END IF;
END $$;

DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'credit_notes' AND column_name = 'sale_order_date'
  ) THEN
    -- Only set NOT NULL if all rows have a value
    IF NOT EXISTS (SELECT 1 FROM credit_notes WHERE sale_order_date IS NULL) THEN
      ALTER TABLE credit_notes ALTER COLUMN sale_order_date SET NOT NULL;
    END IF;
  END IF;
END $$;

-- Add index on sale_order_date for better query performance (only if not exists)
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_invoices_sale_order_date'
  ) THEN
    CREATE INDEX idx_invoices_sale_order_date ON invoices(sale_order_date);
  END IF;
END $$;

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_credit_notes_sale_order_date'
  ) THEN
    CREATE INDEX idx_credit_notes_sale_order_date ON credit_notes(sale_order_date);
  END IF;
END $$;

-- Drop and recreate the net_sales_view to use sale_order_date
DROP VIEW IF EXISTS net_sales_view;

CREATE VIEW net_sales_view AS
SELECT 
  i.id,
  i.invoice_number as reference,
  i.partner_name,
  i.payment_method_id,
  pm.name_en as payment_method_name,
  pm.code as payment_method_code,
  i.invoice_date,
  i.sale_order_date,
  i.due_date,
  i.amount_untaxed,
  i.amount_tax,
  i.amount_total,
  i.state,
  'invoice' as type,
  COALESCE(
    (SELECT SUM(cn.amount_total) 
     FROM credit_notes cn 
     WHERE cn.original_invoice_id = i.id 
     AND cn.state = 'posted'),
    0
  ) as total_credits,
  i.amount_total - COALESCE(
    (SELECT SUM(cn.amount_total) 
     FROM credit_notes cn 
     WHERE cn.original_invoice_id = i.id 
     AND cn.state = 'posted'),
    0
  ) as net_amount
FROM invoices i
LEFT JOIN payment_methods pm ON i.payment_method_id = pm.id
WHERE i.state = 'posted';

-- Drop and recreate dashboard_summary view to use sale_order_date
DROP VIEW IF EXISTS dashboard_summary;

CREATE VIEW dashboard_summary AS
SELECT
  -- Total Sales (Posted Invoices)
  COALESCE(SUM(CASE WHEN i.state = 'posted' THEN i.amount_total ELSE 0 END), 0) as total_sales,
  
  -- Total Credits (Posted Credit Notes)
  COALESCE(SUM(CASE WHEN cn.state = 'posted' THEN cn.amount_total ELSE 0 END), 0) as total_credits,
  
  -- Net Sales
  COALESCE(SUM(CASE WHEN i.state = 'posted' THEN i.amount_total ELSE 0 END), 0) - 
  COALESCE(SUM(CASE WHEN cn.state = 'posted' THEN cn.amount_total ELSE 0 END), 0) as net_sales,
  
  -- Pending Approvals
  (SELECT COUNT(*) FROM accounting_uploads WHERE status = 'pending') as pending_approvals,
  
  -- Total Invoices Count
  COUNT(DISTINCT i.id) as total_invoices,
  
  -- Total Credit Notes Count
  COUNT(DISTINCT cn.id) as total_credit_notes,
  
  -- Date Range
  MIN(LEAST(i.sale_order_date, cn.sale_order_date)) as earliest_date,
  MAX(GREATEST(i.sale_order_date, cn.sale_order_date)) as latest_date
  
FROM invoices i
FULL OUTER JOIN credit_notes cn ON 1=1;

COMMENT ON COLUMN invoices.sale_order_date IS 'The actual sale order date - used for all calculations and reporting';
COMMENT ON COLUMN credit_notes.sale_order_date IS 'The actual sale order date - used for all calculations and reporting';
COMMENT ON VIEW net_sales_view IS 'Aggregated view of invoices with their credits, using sale_order_date for all date operations';
COMMENT ON VIEW dashboard_summary IS 'Summary statistics for dashboard, using sale_order_date as the primary date field';

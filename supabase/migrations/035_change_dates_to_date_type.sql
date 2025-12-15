-- =====================================================
-- Migration 035: Change Date Columns from TIMESTAMPTZ to DATE
-- =====================================================
-- Purpose: Prevent timezone conversion issues
-- Changes: sale_order_date, invoice_date, credit_date to DATE type
-- =====================================================

-- =====================================================
-- 1. Drop dependent views first
-- =====================================================
DROP VIEW IF EXISTS net_sales_view CASCADE;
DROP VIEW IF EXISTS reports_view CASCADE;

-- =====================================================
-- 2. Change invoices table columns to DATE
-- =====================================================
ALTER TABLE invoices 
  ALTER COLUMN sale_order_date TYPE DATE USING sale_order_date::DATE;

ALTER TABLE invoices 
  ALTER COLUMN invoice_date TYPE DATE USING invoice_date::DATE;

-- =====================================================
-- 3. Change credit_notes table columns to DATE
-- =====================================================
ALTER TABLE credit_notes 
  ALTER COLUMN sale_order_date TYPE DATE USING sale_order_date::DATE;

ALTER TABLE credit_notes 
  ALTER COLUMN credit_date TYPE DATE USING credit_date::DATE;

-- =====================================================
-- 4. Recreate net_sales_view
-- =====================================================
CREATE OR REPLACE VIEW net_sales_view AS
SELECT 
  i.sale_order_date,
  i.payment_method_id,
  pm.name_en as payment_method_name,
  SUM(i.amount_total) as total_invoices,
  COALESCE(SUM(c.credit_amount), 0) as total_credits,
  SUM(i.amount_total) - COALESCE(SUM(c.credit_amount), 0) as net_sales
FROM invoices i
LEFT JOIN payment_methods pm ON i.payment_method_id = pm.id
LEFT JOIN (
  SELECT 
    original_invoice_id,
    SUM(ABS(amount_total)) as credit_amount
  FROM credit_notes
  WHERE state = 'posted'
  GROUP BY original_invoice_id
) c ON i.id = c.original_invoice_id
WHERE i.state = 'posted'
GROUP BY i.sale_order_date, i.payment_method_id, pm.name_en;

-- =====================================================
-- 5. Recreate reports_view (if exists)
-- =====================================================
CREATE OR REPLACE VIEW reports_view AS
SELECT 
  i.sale_order_date,
  i.payment_method_id,
  pm.name_en as payment_method_name,
  i.amount_total as invoice_amount,
  COALESCE(c.credit_amount, 0) as credit_amount,
  i.amount_total - COALESCE(c.credit_amount, 0) as net_amount,
  d.net_amount as deposit_amount,
  d.status as deposit_status
FROM invoices i
LEFT JOIN payment_methods pm ON i.payment_method_id = pm.id
LEFT JOIN (
  SELECT 
    original_invoice_id,
    SUM(ABS(amount_total)) as credit_amount
  FROM credit_notes
  WHERE state = 'posted'
  GROUP BY original_invoice_id
) c ON i.id = c.original_invoice_id
LEFT JOIN deposits d ON i.payment_method_id = d.payment_method_id
  AND i.sale_order_date BETWEEN d.start_date AND d.end_date
WHERE i.state = 'posted';

-- =====================================================
-- 6. Update dashboard aggregations function (no more need for ::DATE cast in WHERE)
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_invoices_amount NUMERIC,
  total_invoices_count BIGINT,
  total_credits_amount NUMERIC,
  total_credits_count BIGINT,
  net_sales NUMERIC,
  total_deposits_amount NUMERIC,
  total_deposits_count BIGINT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  -- Now sale_order_date is DATE type, no casting needed
  WITH invoice_stats AS (
    SELECT 
      COALESCE(SUM(amount_total), 0) as total_amount,
      COUNT(*) as total_count
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date >= p_start_date
      AND sale_order_date <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  ),
  credit_stats AS (
    SELECT 
      COALESCE(SUM(ABS(amount_total)), 0) as total_amount,
      COUNT(*) as total_count
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date >= p_start_date
      AND sale_order_date <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  ),
  deposit_stats AS (
    SELECT 
      COALESCE(SUM(net_amount), 0) as total_amount,
      COUNT(*) as total_count
    FROM deposits
    WHERE start_date <= p_end_date
      AND end_date >= p_start_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  )
  SELECT 
    i.total_amount::NUMERIC as total_invoices_amount,
    i.total_count as total_invoices_count,
    c.total_amount::NUMERIC as total_credits_amount,
    c.total_count as total_credits_count,
    (i.total_amount - c.total_amount)::NUMERIC as net_sales,
    d.total_amount::NUMERIC as total_deposits_amount,
    d.total_count as total_deposits_count
  FROM invoice_stats i, credit_stats c, deposit_stats d;
$$;

-- =====================================================
-- 7. Update daily aggregations function (no more need for ::DATE cast)
-- =====================================================
CREATE OR REPLACE FUNCTION get_daily_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  allocation_date DATE,
  daily_sales NUMERIC,
  approved_deposits NUMERIC,
  pending_deposits NUMERIC,
  daily_gap NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH date_series AS (
    SELECT d::DATE as day
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d
  ),
  -- Now sale_order_date is DATE type, no casting needed
  daily_invoices AS (
    SELECT 
      sale_order_date as day,
      SUM(amount_total) as total_invoices
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date >= p_start_date
      AND sale_order_date <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date
  ),
  daily_credits AS (
    SELECT 
      sale_order_date as day,
      SUM(ABS(amount_total)) as total_credits
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date >= p_start_date
      AND sale_order_date <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date
  ),
  daily_sales_data AS (
    SELECT 
      COALESCE(di.day, dc.day) as day,
      COALESCE(di.total_invoices, 0) - COALESCE(dc.total_credits, 0) as sales
    FROM daily_invoices di
    FULL OUTER JOIN daily_credits dc ON di.day = dc.day
  ),
  daily_approved AS (
    SELECT 
      da.allocation_date as day,
      SUM(da.allocated_amount) as approved
    FROM deposit_allocations da
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
  ),
  daily_pending AS (
    SELECT 
      ds.day,
      COALESCE(SUM(d.net_amount / (d.end_date - d.start_date + 1)), 0) as pending
    FROM date_series ds
    LEFT JOIN deposits d ON ds.day BETWEEN d.start_date AND d.end_date
      AND d.status = 'pending'
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY ds.day
  )
  SELECT 
    ds.day as allocation_date,
    COALESCE(dsd.sales, 0) as daily_sales,
    COALESCE(dap.approved, 0) as approved_deposits,
    COALESCE(dpe.pending, 0) as pending_deposits,
    GREATEST(0, COALESCE(dsd.sales, 0) - COALESCE(dap.approved, 0)) as daily_gap
  FROM date_series ds
  LEFT JOIN daily_sales_data dsd ON dsd.day = ds.day
  LEFT JOIN daily_approved dap ON dap.day = ds.day
  LEFT JOIN daily_pending dpe ON dpe.day = ds.day
  ORDER BY ds.day;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_aggregations(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_aggregations(DATE, DATE, UUID) TO authenticated;

-- =====================================================
-- Test Queries
-- =====================================================
-- 
-- Check column types:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'invoices' AND column_name IN ('sale_order_date', 'invoice_date');
-- 
-- Test aggregations:
-- SELECT * FROM get_dashboard_aggregations('2025-12-10', '2025-12-10', '87dce688-0af9-4be8-8a1a-e7b33663f655');
-- 
-- =====================================================

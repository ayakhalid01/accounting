-- =====================================================
-- Migration 021: Dashboard Statistics Views
-- =====================================================
-- Purpose: Create materialized views for fast statistics
-- Instead of loading all data, query pre-calculated stats
-- =====================================================

-- Drop existing views if they exist
DROP MATERIALIZED VIEW IF EXISTS dashboard_statistics CASCADE;

-- =====================================================
-- 1. Create Dashboard Statistics Materialized View
-- =====================================================
CREATE MATERIALIZED VIEW dashboard_statistics AS
SELECT 
  -- User ID for filtering
  imported_by,
  
  -- Invoice statistics
  (SELECT COUNT(*) FROM invoices WHERE imported_by = i.imported_by) AS total_invoices_count,
  (SELECT COALESCE(SUM(amount_total), 0) FROM invoices WHERE imported_by = i.imported_by) AS total_invoices_amount,
  
  -- Credit statistics (only linked credits)
  (SELECT COUNT(*) FROM credit_notes WHERE imported_by = i.imported_by AND original_invoice_id IS NOT NULL) AS total_credits_count,
  (SELECT COALESCE(SUM(amount_total), 0) FROM credit_notes WHERE imported_by = i.imported_by AND original_invoice_id IS NOT NULL) AS total_credits_amount,
  
  -- Net amount (invoices total - only matched credits)
  (
    SELECT COALESCE(SUM(
      inv.amount_total - COALESCE(matched_credits.total_credits, 0)
    ), 0)
    FROM invoices inv
    LEFT JOIN (
      SELECT 
        original_invoice_id,
        SUM(amount_total) as total_credits
      FROM credit_notes
      WHERE original_invoice_id IS NOT NULL
      GROUP BY original_invoice_id
    ) matched_credits ON matched_credits.original_invoice_id = inv.id
    WHERE inv.imported_by = i.imported_by
  ) AS net_amount,
  
  -- Last updated
  NOW() AS last_updated

FROM (SELECT DISTINCT imported_by FROM invoices) i;

-- Create index for fast lookup by user
CREATE UNIQUE INDEX idx_dashboard_stats_user ON dashboard_statistics(imported_by);

-- =====================================================
-- 2. Create function to refresh statistics
-- =====================================================
CREATE OR REPLACE FUNCTION refresh_dashboard_statistics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_statistics;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_dashboard_statistics() TO authenticated;

-- =====================================================
-- 3. Create function to get user statistics
-- =====================================================
CREATE OR REPLACE FUNCTION get_dashboard_statistics()
RETURNS TABLE (
  total_invoices_count BIGINT,
  total_invoices_amount NUMERIC,
  total_credits_count BIGINT,
  total_credits_amount NUMERIC,
  net_amount NUMERIC,
  last_updated TIMESTAMP
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    total_invoices_count,
    total_invoices_amount,
    total_credits_count,
    total_credits_amount,
    net_amount,
    last_updated
  FROM dashboard_statistics
  WHERE imported_by = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_statistics() TO authenticated;

-- =====================================================
-- 4. Auto-refresh trigger (optional - can be heavy)
-- =====================================================
-- Uncomment if you want auto-refresh on insert/update/delete
-- Note: This can be slow on large operations

/*
CREATE OR REPLACE FUNCTION trigger_refresh_dashboard_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refresh in background (don't wait)
  PERFORM refresh_dashboard_statistics();
  RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_stats_on_invoice_change
AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_refresh_dashboard_stats();

CREATE TRIGGER refresh_stats_on_credit_change
AFTER INSERT OR UPDATE OR DELETE ON credit_notes
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_refresh_dashboard_stats();
*/

-- =====================================================
-- 5. Initial refresh
-- =====================================================
REFRESH MATERIALIZED VIEW dashboard_statistics;

-- =====================================================
-- Usage Instructions
-- =====================================================
-- 
-- To get statistics in your app:
-- const { data } = await supabase.rpc('get_dashboard_statistics');
-- 
-- To manually refresh (after big imports):
-- await supabase.rpc('refresh_dashboard_statistics');
-- 
-- Statistics include:
-- - total_invoices_count
-- - total_invoices_amount
-- - total_credits_count (only linked)
-- - total_credits_amount (only linked)
-- - net_amount
-- - last_updated
-- =====================================================

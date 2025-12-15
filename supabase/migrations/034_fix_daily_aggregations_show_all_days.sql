-- =====================================================
-- Migration 034: Fix Daily Aggregations to Show All Days with Sales
-- =====================================================
-- Purpose: Calculate sales directly from invoices/credits, not from deposit_allocations
-- This ensures days with sales but no deposits still appear in the chart
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
  -- Calculate sales directly from invoices and credits (NOT from deposit_allocations)
  -- Use TIMESTAMPTZ comparison (sale_order_date is TIMESTAMPTZ, not DATE)
  daily_invoices AS (
    SELECT 
      sale_order_date::DATE as day,
      SUM(amount_total) as total_invoices
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  daily_credits AS (
    SELECT 
      sale_order_date::DATE as day,
      SUM(ABS(amount_total)) as total_credits
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  daily_sales_data AS (
    SELECT 
      COALESCE(di.day, dc.day) as day,
      COALESCE(di.total_invoices, 0) - COALESCE(dc.total_credits, 0) as sales
    FROM daily_invoices di
    FULL OUTER JOIN daily_credits dc ON di.day = dc.day
  ),
  -- Get approved deposits from allocations
  daily_approved AS (
    SELECT 
      da.allocation_date as day,
      SUM(da.allocated_amount) as approved
    FROM deposit_allocations da
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
  ),
  -- Calculate pending deposits by day
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

GRANT EXECUTE ON FUNCTION get_daily_aggregations(DATE, DATE, UUID) TO authenticated;

-- =====================================================
-- Test Query
-- =====================================================
-- 
-- This should now show ALL days with sales, even if they have no deposits:
-- SELECT * FROM get_daily_aggregations('2025-12-01', '2025-12-10', 'b6510f6e-8d55-43ea-ab49-697867028814');
-- 
-- Before: Only showed days 1-5 (days with allocations)
-- After: Shows days 1-10 (all days, even with 0 sales/deposits)
-- 
-- =====================================================

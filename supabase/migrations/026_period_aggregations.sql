-- =====================================================
-- Migration 026: Period-Based Aggregations for Charts
-- =====================================================
-- Purpose: Get accurate monthly/daily aggregations
-- Fix: Charts showing wrong data (based on 1000 records limit)
-- =====================================================

-- =====================================================
-- 1. Monthly Aggregations Function (Optimized)
-- =====================================================
CREATE OR REPLACE FUNCTION get_monthly_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  period_month TEXT,
  period_start DATE,
  period_end DATE,
  total_invoices NUMERIC,
  total_credits NUMERIC,
  net_sales NUMERIC,
  approved_deposits NUMERIC,
  pending_deposits NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  -- Single query with month buckets (much faster than WHILE loop)
  WITH months AS (
    -- Generate all months in date range
    SELECT 
      DATE_TRUNC('month', d)::DATE as month_start,
      (DATE_TRUNC('month', d) + INTERVAL '1 month - 1 day')::DATE as month_end
    FROM generate_series(
      DATE_TRUNC('month', p_start_date),
      DATE_TRUNC('month', p_end_date),
      INTERVAL '1 month'
    ) d
  ),
  invoice_agg AS (
    SELECT 
      DATE_TRUNC('month', sale_order_date)::DATE as month,
      SUM(amount_total) as total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', sale_order_date)
  ),
  credit_agg AS (
    SELECT 
      DATE_TRUNC('month', sale_order_date)::DATE as month,
      SUM(ABS(amount_total)) as total
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', sale_order_date)
  ),
  deposit_agg AS (
    SELECT 
      m.month_start,
      SUM(CASE WHEN d.status = 'approved' THEN d.net_amount ELSE 0 END) as approved,
      SUM(CASE WHEN d.status = 'pending' THEN d.net_amount ELSE 0 END) as pending
    FROM months m
    LEFT JOIN deposits d ON d.start_date <= m.month_end AND d.end_date >= m.month_start
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY m.month_start
  )
  SELECT 
    TO_CHAR(m.month_start, 'Mon YYYY') as period_month,
    m.month_start as period_start,
    m.month_end as period_end,
    COALESCE(i.total, 0)::NUMERIC as total_invoices,
    COALESCE(c.total, 0)::NUMERIC as total_credits,
    (COALESCE(i.total, 0) - COALESCE(c.total, 0))::NUMERIC as net_sales,
    COALESCE(da.approved, 0)::NUMERIC as approved_deposits,
    COALESCE(da.pending, 0)::NUMERIC as pending_deposits
  FROM months m
  LEFT JOIN invoice_agg i ON i.month = m.month_start
  LEFT JOIN credit_agg c ON c.month = m.month_start
  LEFT JOIN deposit_agg da ON da.month_start = m.month_start
  ORDER BY m.month_start;
$$;

GRANT EXECUTE ON FUNCTION get_monthly_aggregations(DATE, DATE, UUID) TO authenticated;

-- =====================================================
-- Usage Instructions
-- =====================================================
-- 
-- From JavaScript:
-- const { data } = await supabase.rpc('get_monthly_aggregations', {
--   p_start_date: '2025-11-01',
--   p_end_date: '2025-12-31',
--   p_payment_method_id: null
-- });
-- 
-- Returns rows for each month with:
-- - period_month: "Nov 2025", "Dec 2025"
-- - period_start: 2025-11-01
-- - period_end: 2025-11-30
-- - total_invoices: 120758584.38
-- - total_credits: 16232960.52
-- - net_sales: 104525623.86
-- - approved_deposits: 11000
-- - pending_deposits: 1600
-- 
-- Benefits:
-- - Accurate per-month aggregations (no 1000 limit)
-- - Fast performance with existing indexes
-- - Works for any date range
-- - Supports payment method filtering
-- =====================================================

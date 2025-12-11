-- =====================================================
-- Migration 033: Fix Dashboard Aggregations Date Logic
-- =====================================================
-- Purpose: Use same date filtering logic as frontend (inclusive)
-- Change from BETWEEN to >= start AND < next_day
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
  -- Single query with CTEs for better performance
  -- Use ::DATE cast for exact date comparison (same as invoices page frontend)
  WITH invoice_stats AS (
    SELECT 
      COALESCE(SUM(amount_total), 0) as total_amount,
      COUNT(*) as total_count
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  ),
  credit_stats AS (
    SELECT 
      COALESCE(SUM(ABS(amount_total)), 0) as total_amount,
      COUNT(*) as total_count
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
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

GRANT EXECUTE ON FUNCTION get_dashboard_aggregations(DATE, DATE, UUID) TO authenticated;

-- =====================================================
-- Test Query
-- =====================================================
-- 
-- Compare results with old BETWEEN logic:
-- SELECT * FROM get_dashboard_aggregations('2025-12-08', '2025-12-10', 'b6510f6e-8d55-43ea-ab49-697867028814');
-- 
-- Should now match frontend table sum exactly!
-- 
-- =====================================================

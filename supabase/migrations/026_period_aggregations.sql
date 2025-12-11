-- =====================================================
-- Migration 026: Period-Based Aggregations for Charts
-- =====================================================
-- Purpose: Get accurate monthly/daily aggregations
-- Fix: Charts showing wrong data (based on 1000 records limit)
-- =====================================================

-- =====================================================
-- 1. Monthly Aggregations Function
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
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  current_date DATE := DATE_TRUNC('month', p_start_date);
  end_month DATE := DATE_TRUNC('month', p_end_date);
BEGIN
  WHILE current_date <= end_month LOOP
    RETURN QUERY
    SELECT 
      TO_CHAR(current_date, 'Mon YYYY') as period_month,
      current_date as period_start,
      (current_date + INTERVAL '1 month - 1 day')::DATE as period_end,
      
      -- Invoices for this month
      COALESCE(
        (SELECT SUM(amount_total) 
         FROM invoices 
         WHERE state = 'posted'
           AND sale_order_date >= current_date
           AND sale_order_date < (current_date + INTERVAL '1 month')
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) as total_invoices,
      
      -- Credits for this month
      COALESCE(
        (SELECT SUM(ABS(amount_total))
         FROM credit_notes
         WHERE state = 'posted'
           AND original_invoice_id IS NOT NULL
           AND sale_order_date >= current_date
           AND sale_order_date < (current_date + INTERVAL '1 month')
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) as total_credits,
      
      -- Net Sales
      COALESCE(
        (SELECT SUM(amount_total) 
         FROM invoices 
         WHERE state = 'posted'
           AND sale_order_date >= current_date
           AND sale_order_date < (current_date + INTERVAL '1 month')
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) - COALESCE(
        (SELECT SUM(ABS(amount_total))
         FROM credit_notes
         WHERE state = 'posted'
           AND original_invoice_id IS NOT NULL
           AND sale_order_date >= current_date
           AND sale_order_date < (current_date + INTERVAL '1 month')
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) as net_sales,
      
      -- Approved Deposits for this month
      COALESCE(
        (SELECT SUM(net_amount)
         FROM deposits
         WHERE status = 'approved'
           AND start_date <= (current_date + INTERVAL '1 month - 1 day')::DATE
           AND end_date >= current_date
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) as approved_deposits,
      
      -- Pending Deposits for this month
      COALESCE(
        (SELECT SUM(net_amount)
         FROM deposits
         WHERE status = 'pending'
           AND start_date <= (current_date + INTERVAL '1 month - 1 day')::DATE
           AND end_date >= current_date
           AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
        ), 0
      ) as pending_deposits;
    
    current_date := current_date + INTERVAL '1 month';
  END LOOP;
END;
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

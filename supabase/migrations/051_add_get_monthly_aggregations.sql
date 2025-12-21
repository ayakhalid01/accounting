-- =====================================================
-- Migration 051: Ensure get_monthly_aggregations RPC exists
-- =====================================================
-- Purpose: Create or replace the get_monthly_aggregations function so
-- the API (PostgREST / Supabase) can find the RPC with the expected
-- signature: (p_start_date DATE, p_end_date DATE, p_payment_method_id UUID)
-- =====================================================


CREATE OR REPLACE FUNCTION public.get_monthly_aggregations(
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
  WITH months AS (
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
  -- Use deposit_allocations to compute how much deposit was actually allocated/approved per month.
  -- This ensures approved_deposits reflect allocations applied to methods/days (not the raw deposit.net_amount),
  -- so if Aman had net sales 42k but a grouped deposit was 60k, only 42k will be counted for Aman when allocations applied.
  deposit_agg AS (
    SELECT
      DATE_TRUNC('month', da.allocation_date)::DATE as month,
      SUM(da.allocated_amount) as approved
    FROM deposit_allocations da
    JOIN deposits d ON d.id = da.deposit_id
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND d.status = 'approved'
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', da.allocation_date)
  ),
  pending_deposits AS (
    SELECT 
      DATE_TRUNC('month', d.start_date)::DATE as month,
      SUM(CASE WHEN d.status = 'pending' THEN d.net_amount ELSE 0 END) as pending
    FROM deposits d
    WHERE d.start_date <= p_end_date AND d.end_date >= p_start_date
      AND (p_payment_method_id IS NULL OR d.payment_method_id = p_payment_method_id)
    GROUP BY DATE_TRUNC('month', d.start_date)
  )
  SELECT 
    TO_CHAR(m.month_start, 'Mon YYYY') as period_month,
    m.month_start as period_start,
    m.month_end as period_end,
    COALESCE(i.total, 0)::NUMERIC as total_invoices,
    COALESCE(c.total, 0)::NUMERIC as total_credits,
    (COALESCE(i.total, 0) - COALESCE(c.total, 0))::NUMERIC as net_sales,
    -- Cap approved deposits to the month's net sales to avoid showing an approved amount larger than actual sales
    LEAST(COALESCE(da.approved, 0), (COALESCE(i.total, 0) - COALESCE(c.total, 0)))::NUMERIC as approved_deposits,
    COALESCE(pd.pending, 0)::NUMERIC as pending_deposits
  FROM months m
  LEFT JOIN invoice_agg i ON i.month = m.month_start
  LEFT JOIN credit_agg c ON c.month = m.month_start
  LEFT JOIN deposit_agg da ON da.month = m.month_start
  LEFT JOIN pending_deposits pd ON pd.month = m.month_start
  ORDER BY m.month_start;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_aggregations(DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_monthly_aggregations IS 'Monthly aggregations: invoices, credits, net_sales, approved and pending deposits per month';

-- Note: After applying this migration, refresh the Supabase API schema cache
-- (API settings → Refresh schema) so PostgREST recognizes the new RPC.

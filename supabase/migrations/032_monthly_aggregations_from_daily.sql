-- =====================================================
-- Migration 032: Monthly Aggregations from Daily Data
-- =====================================================
-- Purpose: Group daily allocations by month for dashboard
-- Uses existing deposit_allocations table
-- =====================================================

CREATE OR REPLACE FUNCTION get_monthly_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  year_month TEXT,
  month_start DATE,
  month_end DATE,
  total_sales NUMERIC,
  approved_deposits NUMERIC,
  pending_deposits NUMERIC,
  gap NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH invoices_daily AS (
    -- Get daily invoices totals
    SELECT 
      sale_order_date::DATE as sale_date,
      SUM(amount_total) as daily_invoices
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  credits_daily AS (
    -- Get daily credits totals
    SELECT 
      sale_order_date::DATE as sale_date,
      SUM(ABS(amount_total)) as daily_credits
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date::DATE >= p_start_date
      AND sale_order_date::DATE <= p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  daily_sales AS (
    -- Combine invoices and credits
    SELECT 
      COALESCE(i.sale_date, c.sale_date) as sale_date,
      COALESCE(i.daily_invoices, 0) - COALESCE(c.daily_credits, 0) as net_sales
    FROM invoices_daily i
    FULL OUTER JOIN credits_daily c ON i.sale_date = c.sale_date
  ),
  monthly_sales AS (
    -- Group by month
    SELECT 
      TO_CHAR(sale_date, 'YYYY-MM') as ym,
      DATE_TRUNC('month', sale_date)::DATE as m_start,
      (DATE_TRUNC('month', sale_date) + INTERVAL '1 month - 1 day')::DATE as m_end,
      SUM(net_sales) as month_sales
    FROM daily_sales
    GROUP BY TO_CHAR(sale_date, 'YYYY-MM'), DATE_TRUNC('month', sale_date)
  ),
  daily_allocations AS (
    -- Get approved/pending amounts per day from deposit_allocations
    SELECT 
      da.allocation_date,
      SUM(
        CASE 
          WHEN d.status = 'approved' THEN da.allocated_amount
          ELSE 0
        END
      ) as daily_approved,
      SUM(
        CASE 
          WHEN d.status = 'pending' THEN da.allocated_amount
          ELSE 0
        END
      ) as daily_pending
    FROM deposit_allocations da
    INNER JOIN deposits d ON d.id = da.deposit_id
    WHERE da.allocation_date >= p_start_date
      AND da.allocation_date <= p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
  ),
  monthly_deposits AS (
    -- Group daily allocations by month
    SELECT 
      TO_CHAR(allocation_date, 'YYYY-MM') as ym,
      SUM(daily_approved) as month_approved,
      SUM(daily_pending) as month_pending
    FROM daily_allocations
    GROUP BY TO_CHAR(allocation_date, 'YYYY-MM')
  )
  SELECT 
    ms.ym as year_month,
    ms.m_start as month_start,
    ms.m_end as month_end,
    COALESCE(ms.month_sales, 0) as total_sales,
    COALESCE(md.month_approved, 0) as approved_deposits,
    COALESCE(md.month_pending, 0) as pending_deposits,
    COALESCE(ms.month_sales, 0) - COALESCE(md.month_approved, 0) as gap
  FROM monthly_sales ms
  LEFT JOIN monthly_deposits md ON ms.ym = md.ym
  ORDER BY ms.ym;
END;
$$;

GRANT EXECUTE ON FUNCTION get_monthly_aggregations(DATE, DATE, UUID) TO authenticated;

-- =====================================================
-- Usage Examples
-- =====================================================
-- 
-- 1. Get monthly aggregations for date range:
-- SELECT * FROM get_monthly_aggregations('2025-09-01', '2025-11-30', NULL);
-- 
-- 2. Get monthly aggregations for specific payment method:
-- SELECT * FROM get_monthly_aggregations('2025-09-01', '2025-11-30', '<payment_method_id>');
-- 
-- 3. Get single month:
-- SELECT * FROM get_monthly_aggregations('2025-09-01', '2025-09-30', NULL);
-- 
-- =====================================================

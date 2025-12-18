-- Migration 048: Update get_daily_aggregations to include invoice & allocation sales
-- Purpose: Return both invoice-based daily sales and allocation-based daily sales

CREATE OR REPLACE FUNCTION get_daily_aggregations(
  p_start_date DATE,
  p_end_date DATE,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  allocation_date DATE,
  daily_sales_invoices NUMERIC,
  daily_sales_allocations NUMERIC,
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
  invoices_daily AS (
    SELECT sale_order_date::DATE as day, SUM(amount_total) as total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date::DATE BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  credits_daily AS (
    SELECT sale_order_date::DATE as day, SUM(ABS(amount_total)) as total
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date::DATE BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
    GROUP BY sale_order_date::DATE
  ),
  invoice_sales AS (
    SELECT COALESCE(i.day, c.day) as day, COALESCE(i.total, 0) - COALESCE(c.total, 0) as net_sales
    FROM invoices_daily i
    FULL OUTER JOIN credits_daily c ON i.day = c.day
  ),
  -- Sum of daily_sales from deposit_allocations (may not include methods without deposits)
  daily_allocations AS (
    SELECT da.allocation_date as day, SUM(da.daily_sales) as sum_daily_sales
    FROM deposit_allocations da
    WHERE da.allocation_date BETWEEN p_start_date AND p_end_date
      AND (p_payment_method_id IS NULL OR da.payment_method_id = p_payment_method_id)
    GROUP BY da.allocation_date
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
    COALESCE(inv.net_sales, 0) as daily_sales_invoices,
    COALESCE(da.sum_daily_sales, 0) as daily_sales_allocations,
    COALESCE(dap.approved, 0) as approved_deposits,
    COALESCE(dpe.pending, 0) as pending_deposits,
    GREATEST(0, COALESCE(inv.net_sales, 0) - COALESCE(dap.approved, 0)) as daily_gap
  FROM date_series ds
  LEFT JOIN invoice_sales inv ON inv.day = ds.day
  LEFT JOIN daily_allocations da ON da.day = ds.day
  LEFT JOIN daily_approved dap ON dap.day = ds.day
  LEFT JOIN daily_pending dpe ON dpe.day = ds.day
  ORDER BY ds.day;
$$;

GRANT EXECUTE ON FUNCTION get_daily_aggregations(DATE, DATE, UUID) TO authenticated;
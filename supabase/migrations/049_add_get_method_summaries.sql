-- 049_add_get_method_summaries.sql
-- Return per-payment-method summaries for a given period (invoices, credits, net, approved allocations, pending deposits, gap)

CREATE OR REPLACE FUNCTION public.get_method_summaries(
  p_start_date date,
  p_end_date date,
  p_payment_method_id uuid DEFAULT NULL
)
RETURNS TABLE(
  payment_method_id uuid,
  name text,
  invoices numeric,
  credits numeric,
  net_invoices numeric,
  approved_alloc numeric,
  pending_amt numeric,
  gap numeric
) AS $$
SELECT
  pm.id::uuid AS payment_method_id,
  COALESCE(pm.name_en, pm.name, 'Unknown')::text AS name,
  COALESCE(inv.total_invoices, 0)::numeric AS invoices,
  COALESCE(cr.total_credits, 0)::numeric AS credits,
  (COALESCE(inv.total_invoices, 0) - COALESCE(cr.total_credits, 0))::numeric AS net_invoices,
  COALESCE(allocs.approved_alloc, 0)::numeric AS approved_alloc,
  COALESCE(pending.pending_amt, 0)::numeric AS pending_amt,
  ((COALESCE(inv.total_invoices, 0) - COALESCE(cr.total_credits, 0)) - COALESCE(allocs.approved_alloc, 0))::numeric AS gap
FROM payment_methods pm
LEFT JOIN (
  SELECT payment_method_id, SUM(amount_total)::numeric AS total_invoices
  FROM invoices
  WHERE state = 'posted' AND sale_order_date BETWEEN p_start_date AND p_end_date
  GROUP BY payment_method_id
) inv ON inv.payment_method_id = pm.id
LEFT JOIN (
  SELECT payment_method_id, SUM(ABS(amount_total))::numeric AS total_credits
  FROM credit_notes
  WHERE state = 'posted' AND original_invoice_id IS NOT NULL AND sale_order_date BETWEEN p_start_date AND p_end_date
  GROUP BY payment_method_id
) cr ON cr.payment_method_id = pm.id
LEFT JOIN (
  SELECT payment_method_id, SUM(allocated_amount)::numeric AS approved_alloc
  FROM deposit_allocations
  WHERE allocation_date BETWEEN p_start_date AND p_end_date
  GROUP BY payment_method_id
) allocs ON allocs.payment_method_id = pm.id
LEFT JOIN (
  SELECT payment_method_id, SUM(net_amount)::numeric AS pending_amt
  FROM deposits
  WHERE status = 'pending' AND start_date <= p_end_date AND end_date >= p_start_date
  GROUP BY payment_method_id
) pending ON pending.payment_method_id = pm.id
WHERE pm.is_active = true
  -- If no specific method is requested, only include methods with non-zero net invoices
  AND (p_payment_method_id IS NOT NULL OR (COALESCE(inv.total_invoices, 0) - COALESCE(cr.total_credits, 0)) <> 0)
  AND (p_payment_method_id IS NULL OR pm.id = p_payment_method_id)
ORDER BY net_invoices DESC;
$$ LANGUAGE sql STABLE;

-- Index recommendations (run separately if needed):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_sale_order_date_pm ON invoices(sale_order_date, payment_method_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_sale_order_date_pm ON credit_notes(sale_order_date, payment_method_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deposit_allocations_allocation_date_pm ON deposit_allocations(allocation_date, payment_method_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deposits_status_dates_pm ON deposits(status, start_date, end_date, payment_method_id);

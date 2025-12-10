-- =====================================================
-- Migration 022: CSV Export Function (Server-Side)
-- =====================================================
-- Purpose: Export ALL data as CSV from database
-- Much faster and efficient than loading in frontend
-- =====================================================

-- =====================================================
-- 1. Create CSV Export Function for Invoices
-- =====================================================
CREATE OR REPLACE FUNCTION export_invoices_csv()
RETURNS TABLE (
  csv_line TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Return CSV header
  RETURN QUERY
  SELECT 'Type,Number,Customer,Date,Amount Total,Credits Applied,Net Amount,Payment Method,Gateway,Has Credits'::TEXT;
  
  -- Return invoice rows with credits calculated
  RETURN QUERY
  SELECT 
    'Invoice,' ||
    COALESCE(i.invoice_number, '') || ',' ||
    COALESCE(i.customer_name, i.partner_name, '') || ',' ||
    TO_CHAR(i.sale_order_date, 'DD/MM/YYYY') || ',' ||
    COALESCE(i.amount_total::TEXT, '0') || ',' ||
    COALESCE(credits.total_credits::TEXT, '0') || ',' ||
    COALESCE((i.amount_total - COALESCE(credits.total_credits, 0))::TEXT, '0') || ',' ||
    COALESCE(pm.method_name, '') || ',' ||
    COALESCE(i.gateway_name, '') || ',' ||
    CASE WHEN credits.total_credits > 0 THEN 'Yes' ELSE 'No' END
  FROM invoices i
  LEFT JOIN (
    SELECT 
      original_invoice_id,
      SUM(amount_total) as total_credits
    FROM credit_notes
    WHERE original_invoice_id IS NOT NULL
    GROUP BY original_invoice_id
  ) credits ON credits.original_invoice_id = i.id
  LEFT JOIN payment_methods_config pm ON pm.id = i.payment_method_id
  WHERE i.imported_by = auth.uid()
  ORDER BY i.sale_order_date DESC;
  
  -- Return credit note rows
  RETURN QUERY
  SELECT 
    'Credit Note,' ||
    COALESCE(c.credit_note_number, '') || ',' ||
    COALESCE(c.customer_name, c.partner_name, '') || ',' ||
    TO_CHAR(c.credit_date, 'DD/MM/YYYY') || ',' ||
    COALESCE(c.amount_total::TEXT, '0') || ',' ||
    '-,' ||
    '-,' ||
    COALESCE(pm.method_name, '') || ',' ||
    COALESCE(c.gateway_name, '') || ',' ||
    '-'
  FROM credit_notes c
  LEFT JOIN payment_methods_config pm ON pm.id = c.payment_method_id
  WHERE c.imported_by = auth.uid()
    AND c.original_invoice_id IS NOT NULL
  ORDER BY c.credit_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION export_invoices_csv() TO authenticated;

-- =====================================================
-- 2. Alternative: JSON Export (for flexible formatting)
-- =====================================================
CREATE OR REPLACE FUNCTION export_invoices_json()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(
    'invoices', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type', 'Invoice',
          'number', i.invoice_number,
          'customer', COALESCE(i.customer_name, i.partner_name),
          'date', i.sale_order_date,
          'amount_total', i.amount_total,
          'credits_applied', COALESCE(credits.total_credits, 0),
          'net_amount', i.amount_total - COALESCE(credits.total_credits, 0),
          'payment_method', pm.method_name,
          'gateway', i.gateway_name,
          'has_credits', credits.total_credits > 0
        )
      )
      FROM invoices i
      LEFT JOIN (
        SELECT 
          original_invoice_id,
          SUM(amount_total) as total_credits
        FROM credit_notes
        WHERE original_invoice_id IS NOT NULL
        GROUP BY original_invoice_id
      ) credits ON credits.original_invoice_id = i.id
      LEFT JOIN payment_methods_config pm ON pm.id = i.payment_method_id
      WHERE i.imported_by = auth.uid()
    ),
    'credits', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type', 'Credit Note',
          'number', c.credit_note_number,
          'customer', COALESCE(c.customer_name, c.partner_name),
          'date', c.credit_date,
          'amount_total', c.amount_total,
          'payment_method', pm.method_name,
          'gateway', c.gateway_name
        )
      )
      FROM credit_notes c
      LEFT JOIN payment_methods_config pm ON pm.id = c.payment_method_id
      WHERE c.imported_by = auth.uid()
        AND c.original_invoice_id IS NOT NULL
    )
  );
$$;

GRANT EXECUTE ON FUNCTION export_invoices_json() TO authenticated;

-- =====================================================
-- Usage Instructions
-- =====================================================
-- 
-- CSV Export (returns rows of CSV text):
-- SELECT * FROM export_invoices_csv();
-- 
-- JSON Export (returns all data as JSON):
-- SELECT * FROM export_invoices_json();
-- 
-- From JavaScript:
-- const { data } = await supabase.rpc('export_invoices_csv');
-- const csv = data.map(row => row.csv_line).join('\n');
-- 
-- Benefits:
-- - Database does all the work (no 1000 limit)
-- - No need to load ALL data in frontend
-- - Much faster (1-2 seconds instead of 40 seconds)
-- - Less memory usage in browser
-- =====================================================

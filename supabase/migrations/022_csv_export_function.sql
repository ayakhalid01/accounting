-- =====================================================
-- Migration 022: CSV Export Function (Server-Side)
-- =====================================================
-- Purpose: Export ALL data as CSV from database
-- Much faster and efficient than loading in frontend
-- =====================================================

-- =====================================================
-- 1. Create CSV Export Function for Invoices
-- =====================================================
-- Returns ONE row with complete CSV text (bypasses PostgREST 1000 limit)
CREATE OR REPLACE FUNCTION export_invoices_csv()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  csv_header TEXT := 'Type,Number,Sale Date,Amount Total,Credits Applied,Net Amount,Payment Method,Has Credits';
  csv_invoices TEXT;
  csv_credits TEXT;
BEGIN
  -- Build invoice rows
  SELECT string_agg(
    'Invoice,' ||
    COALESCE(i.invoice_number, '') || ',' ||
    TO_CHAR(COALESCE(i.sale_order_date::date, i.invoice_date), 'DD/MM/YYYY') || ',' ||
    COALESCE(i.amount_total::TEXT, '0') || ',' ||
    COALESCE(credits.total_credits::TEXT, '0') || ',' ||
    COALESCE((i.amount_total - COALESCE(credits.total_credits, 0))::TEXT, '0') || ',' ||
    COALESCE(pm.name_en, '') || ',' ||
    CASE WHEN credits.total_credits > 0 THEN 'Yes' ELSE 'No' END,
    E'\n' ORDER BY COALESCE(i.sale_order_date, i.invoice_date) DESC
  )
  INTO csv_invoices
  FROM invoices i
  LEFT JOIN (
    SELECT 
      original_invoice_id,
      SUM(amount_total) as total_credits
    FROM credit_notes
    WHERE original_invoice_id IS NOT NULL
    GROUP BY original_invoice_id
  ) credits ON credits.original_invoice_id = i.id
  LEFT JOIN payment_methods pm ON pm.id = i.payment_method_id
  WHERE i.imported_by = auth.uid();
  
  -- Build credit note rows
  SELECT string_agg(
    'Credit Note,' ||
    COALESCE(c.credit_note_number, '') || ',' ||
    TO_CHAR(c.credit_date, 'DD/MM/YYYY') || ',' ||
    COALESCE(c.amount_total::TEXT, '0') || ',' ||
    '-,' ||
    '-,' ||
    COALESCE(pm.name_en, '') || ',' ||
    '-',
    E'\n' ORDER BY c.credit_date DESC
  )
  INTO csv_credits
  FROM credit_notes c
  LEFT JOIN payment_methods pm ON pm.id = c.payment_method_id
  WHERE c.imported_by = auth.uid()
    AND c.original_invoice_id IS NOT NULL;
  
  -- Combine all parts
  RETURN csv_header || E'\n' || 
         COALESCE(csv_invoices, '') || 
         CASE WHEN csv_credits IS NOT NULL THEN E'\n' || csv_credits ELSE '' END;
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
          'sale_date', i.sale_order_date,
          'invoice_date', i.invoice_date,
          'amount_total', i.amount_total,
          'credits_applied', COALESCE(credits.total_credits, 0),
          'net_amount', i.amount_total - COALESCE(credits.total_credits, 0),
          'payment_method', pm.name_en,
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
      LEFT JOIN payment_methods pm ON pm.id = i.payment_method_id
      WHERE i.imported_by = auth.uid()
    ),
    'credits', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type', 'Credit Note',
          'number', c.credit_note_number,
          'date', c.credit_date,
          'amount_total', c.amount_total,
          'payment_method', pm.name_en
        )
      )
      FROM credit_notes c
      LEFT JOIN payment_methods pm ON pm.id = c.payment_method_id
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
-- CSV Export (returns ONE text string with ALL data):
-- SELECT export_invoices_csv();
-- 
-- JSON Export (returns all data as JSON):
-- SELECT * FROM export_invoices_json();
-- 
-- From JavaScript:
-- const { data } = await supabase.rpc('export_invoices_csv');
-- // data is already complete CSV text (not array!)
-- const blob = new Blob([data], { type: 'text/csv' });
-- 
-- Benefits:
-- - Returns ONE row (bypasses PostgREST 1000 limit)
-- - Database does all the work
-- - No need to load ALL data in frontend
-- - Much faster (1-2 seconds instead of 40 seconds)
-- - Less memory usage in browser
-- =====================================================

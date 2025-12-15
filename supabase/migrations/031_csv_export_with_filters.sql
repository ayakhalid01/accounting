-- =====================================================
-- Migration 031: CSV Export with Filters (OPTIMIZED)
-- =====================================================
-- Purpose: Add parameters to CSV export function for filtering
-- Supports: date range, payment method, document type filters
-- Optimized: Uses simpler queries without complex JOINs
-- =====================================================

-- =====================================================
-- 1. Drop old function and create new one with parameters
-- =====================================================
DROP FUNCTION IF EXISTS export_invoices_csv();

CREATE OR REPLACE FUNCTION export_invoices_csv(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_payment_method_id UUID DEFAULT NULL,
  p_document_type TEXT DEFAULT 'all'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  csv_header TEXT := 'Type,Number,Sale Date,Amount Total,Net Amount,Payment Method';
  csv_result TEXT := '';
  next_day DATE;
BEGIN
  -- Calculate next day for inclusive date range
  IF p_end_date IS NOT NULL THEN
    next_day := p_end_date + INTERVAL '1 day';
  END IF;

  -- Start with header
  csv_result := csv_header || E'\n';

  -- Build invoice rows (only if document_type is 'all' or 'invoices')
  IF p_document_type IN ('all', 'invoices') THEN
    csv_result := csv_result || COALESCE(
      (SELECT string_agg(row_text, E'\n')
       FROM (
         SELECT 
           'Invoice,' ||
           COALESCE(i.invoice_number, '') || ',' ||
           TO_CHAR(COALESCE(i.sale_order_date, i.invoice_date), 'DD/MM/YYYY') || ',' ||
           COALESCE(i.amount_total::TEXT, '0') || ',' ||
           COALESCE(
             (i.amount_total - COALESCE(
               (SELECT SUM(ABS(c.amount_total)) 
                FROM credit_notes c 
                WHERE c.original_invoice_id = i.id 
                  AND c.state = 'posted'),
               0
             ))::TEXT,
             '0'
           ) || ',' ||
           COALESCE(pm.name_en, '') as row_text
         FROM invoices i
         LEFT JOIN payment_methods pm ON pm.id = i.payment_method_id
         WHERE i.state = 'posted'
           AND (p_start_date IS NULL OR i.sale_order_date::DATE >= p_start_date)
           AND (p_end_date IS NULL OR i.sale_order_date::DATE <= p_end_date)
           AND (p_payment_method_id IS NULL OR i.payment_method_id = p_payment_method_id)
         ORDER BY COALESCE(i.sale_order_date, i.invoice_date) DESC
         LIMIT 50000
       ) inv
      ), 
      ''
    );
  END IF;
  
  -- Build credit note rows (only if document_type is 'all' or 'credits')
  IF p_document_type IN ('all', 'credits') THEN
    -- Add newline separator if we have invoices
    IF p_document_type = 'all' AND LENGTH(csv_result) > LENGTH(csv_header || E'\n') THEN
      csv_result := csv_result || E'\n';
    END IF;
    
    csv_result := csv_result || COALESCE(
      (SELECT string_agg(row_text, E'\n')
       FROM (
         SELECT 
           'Credit Note,' ||
           COALESCE(c.credit_note_number, '') || ',' ||
           TO_CHAR(COALESCE(c.sale_order_date, c.credit_date), 'DD/MM/YYYY') || ',' ||
           COALESCE(ABS(c.amount_total)::TEXT, '0') || ',' ||
           COALESCE(c.amount_total::TEXT, '0') || ',' ||
           COALESCE(pm.name_en, '') as row_text
         FROM credit_notes c
         LEFT JOIN payment_methods pm ON pm.id = c.payment_method_id
         WHERE c.state = 'posted'
           AND c.original_invoice_id IS NOT NULL
           AND (p_start_date IS NULL OR c.sale_order_date::DATE >= p_start_date)
           AND (p_end_date IS NULL OR c.sale_order_date::DATE <= p_end_date)
           AND (p_payment_method_id IS NULL OR c.payment_method_id = p_payment_method_id)
         ORDER BY COALESCE(c.sale_order_date, c.credit_date) DESC
         LIMIT 50000
       ) crd
      ),
      ''
    );
  END IF;
  
  RETURN csv_result;
END;
$$;

GRANT EXECUTE ON FUNCTION export_invoices_csv(DATE, DATE, UUID, TEXT) TO authenticated;

-- =====================================================
-- Migration Complete
-- =====================================================
-- 
-- Usage Examples:
-- 
-- 1. Export all data:
-- SELECT export_invoices_csv();
-- 
-- 2. Export with date range:
-- SELECT export_invoices_csv('2025-11-01', '2025-11-30', NULL, 'all');
-- 
-- 3. Export only invoices for specific payment method:
-- SELECT export_invoices_csv('2025-11-01', '2025-11-30', '<payment_method_id>', 'invoices');
-- 
-- 4. Export same day (inclusive):
-- SELECT export_invoices_csv('2025-09-28', '2025-09-28', NULL, 'all');
-- 
-- =====================================================

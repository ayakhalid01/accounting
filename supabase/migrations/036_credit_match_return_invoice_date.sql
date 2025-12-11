-- =====================================================
-- Migration 036: Update Credit Matching to Return Invoice Sale Date
-- =====================================================
-- Purpose: When matching credits to invoices, return the invoice's sale_order_date
-- so credits can inherit the same date as their matched invoice
-- =====================================================

CREATE OR REPLACE FUNCTION match_credits_to_invoices(
  p_credits JSONB  -- Array of credits: [{id, reference, payment_method_id, gateway_name}]
)
RETURNS TABLE (
  credit_id UUID,
  invoice_id UUID,
  invoice_sale_order_date DATE,
  match_type TEXT,
  invoice_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET work_mem = '256MB'
AS $$
DECLARE
  credit_record JSONB;
  matched_invoice RECORD;
  v_reference TEXT;
  v_payment_method_id UUID;
  v_gateway_name TEXT;
  v_credit_id UUID;
BEGIN
  -- Loop through each credit and return results directly
  FOR credit_record IN SELECT * FROM jsonb_array_elements(p_credits)
  LOOP
    v_credit_id := (credit_record->>'id')::UUID;
    v_reference := credit_record->>'reference';
    v_payment_method_id := (credit_record->>'payment_method_id')::UUID;
    v_gateway_name := credit_record->>'gateway_name';
    
    -- Skip if no reference
    IF v_reference IS NULL OR v_reference = '' THEN
      CONTINUE;
    END IF;
    
    -- Try Level 1: Exact match (Reference + Payment Method)
    -- Extract reference from invoice_number (before | separator)
    SELECT 
      inv.id,
      inv.invoice_number,
      inv.sale_order_date
    INTO matched_invoice
    FROM invoices inv
    WHERE SPLIT_PART(inv.invoice_number, '|', 1) = v_reference
      AND inv.payment_method_id = v_payment_method_id
      AND inv.state = 'posted'
    LIMIT 1;
    
    IF FOUND THEN
      -- Return exact match immediately with invoice's sale_order_date
      credit_id := v_credit_id;
      invoice_id := matched_invoice.id;
      invoice_sale_order_date := matched_invoice.sale_order_date;
      match_type := 'exact';
      invoice_number := matched_invoice.invoice_number;
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- Try Level 2: Fallback by gateway name match
    IF v_gateway_name IS NOT NULL AND v_gateway_name != '' THEN
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.sale_order_date
      INTO matched_invoice
      FROM invoices inv
      JOIN payment_methods pm ON pm.id = inv.payment_method_id
      WHERE SPLIT_PART(inv.invoice_number, '|', 1) = v_reference
        AND inv.state = 'posted'
        AND (
          LOWER(pm.name_en) LIKE '%' || LOWER(v_gateway_name) || '%'
          OR LOWER(pm.name_ar) LIKE '%' || LOWER(v_gateway_name) || '%'
          OR LOWER(pm.code) LIKE '%' || LOWER(v_gateway_name) || '%'
        )
      LIMIT 1;
      
      IF FOUND THEN
        -- Return gateway fallback match with invoice's sale_order_date
        credit_id := v_credit_id;
        invoice_id := matched_invoice.id;
        invoice_sale_order_date := matched_invoice.sale_order_date;
        match_type := 'gateway_fallback';
        invoice_number := matched_invoice.invoice_number;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION match_credits_to_invoices(JSONB) TO authenticated;

-- =====================================================
-- Test Query
-- =====================================================
-- 
-- SELECT * FROM match_credits_to_invoices('[
--   {"id": "00000000-0000-0000-0000-000000000001", "reference": "INV123", "payment_method_id": "uuid-here", "gateway_name": "Paymob"}
-- ]'::JSONB);
-- 
-- Should return: credit_id, invoice_id, invoice_sale_order_date, match_type, invoice_number
-- 
-- =====================================================

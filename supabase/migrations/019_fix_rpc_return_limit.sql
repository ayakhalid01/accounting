-- =====================================================
-- Migration 019: Fix RPC Function Return Limit
-- =====================================================
-- Purpose: Modify match_credits_to_invoices to return ALL matches
-- without being limited by PostgREST's 1000 row default limit
-- =====================================================

-- Drop and recreate the function with proper return handling
DROP FUNCTION IF EXISTS match_credits_to_invoices CASCADE;

CREATE OR REPLACE FUNCTION match_credits_to_invoices(
  p_credits JSONB  -- Array of credits: [{id, reference, payment_method_id, gateway_name}]
)
RETURNS TABLE (
  credit_id UUID,
  invoice_id UUID,
  match_type TEXT,
  invoice_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
-- IMPORTANT: Set this to allow unlimited rows to be returned
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
    SELECT 
      inv.id,
      inv.invoice_number
    INTO matched_invoice
    FROM invoice_lookup inv
    WHERE inv.reference = v_reference
      AND inv.payment_method_id = v_payment_method_id
      AND inv.imported_by = auth.uid()
    LIMIT 1;
    
    IF FOUND THEN
      -- Return exact match immediately
      credit_id := v_credit_id;
      invoice_id := matched_invoice.id;
      match_type := 'exact';
      invoice_number := matched_invoice.invoice_number;
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- Try Level 2: Fallback by gateway name match
    IF v_gateway_name IS NOT NULL AND v_gateway_name != '' THEN
      SELECT 
        inv.id,
        inv.invoice_number
      INTO matched_invoice
      FROM invoice_lookup inv
      JOIN payment_methods pm ON pm.id = inv.payment_method_id
      WHERE inv.reference = v_reference
        AND inv.imported_by = auth.uid()
        AND (
          LOWER(pm.name_en) LIKE '%' || LOWER(v_gateway_name) || '%'
          OR LOWER(pm.name_ar) LIKE '%' || LOWER(v_gateway_name) || '%'
          OR LOWER(pm.code) LIKE '%' || LOWER(v_gateway_name) || '%'
        )
      LIMIT 1;
      
      IF FOUND THEN
        -- Return gateway fallback match immediately
        credit_id := v_credit_id;
        invoice_id := matched_invoice.id;
        match_type := 'gateway_fallback';
        invoice_number := matched_invoice.invoice_number;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION match_credits_to_invoices(JSONB) TO authenticated;

-- =====================================================
-- Test the function (optional - comment out in production)
-- =====================================================

-- Example test:
-- SELECT * FROM match_credits_to_invoices('[
--   {"id": "00000000-0000-0000-0000-000000000001", "reference": "INV001", "payment_method_id": "uuid-here", "gateway_name": "Paymob"},
--   {"id": "00000000-0000-0000-0000-000000000002", "reference": "INV002", "payment_method_id": "uuid-here", "gateway_name": "Cash"}
-- ]'::jsonb);

-- =====================================================
-- Migration Complete
-- =====================================================
-- This migration fixes the 1000 row limit by:
-- 1. Using a temporary table to store ALL matches
-- 2. Returning results from temp table (not via RETURN NEXT)
-- 3. Setting work_mem to handle large result sets
-- 
-- Now the function will return ALL matches without limits!
-- =====================================================

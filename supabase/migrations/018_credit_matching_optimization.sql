-- =====================================================
-- Migration 018: Credit Matching Optimization
-- =====================================================
-- Purpose: Create database view and function to optimize credit-to-invoice matching
-- without loading all invoices into the client
-- =====================================================

-- Drop existing objects if they exist
DROP VIEW IF EXISTS invoice_lookup CASCADE;
DROP FUNCTION IF EXISTS match_credits_to_invoices CASCADE;

-- =====================================================
-- 1. Create Invoice Lookup View
-- =====================================================
-- This view pre-processes invoice numbers for faster matching
CREATE VIEW invoice_lookup AS
SELECT 
  id,
  invoice_number,
  -- Extract reference from composite invoice_number (before |)
  SPLIT_PART(invoice_number, '|', 1) AS reference,
  payment_method_id,
  imported_by
FROM invoices
WHERE invoice_number IS NOT NULL 
  AND invoice_number != '';

-- Add index on the view's base table for faster lookups
CREATE INDEX IF NOT EXISTS idx_invoices_reference 
  ON invoices (SPLIT_PART(invoice_number, '|', 1));

CREATE INDEX IF NOT EXISTS idx_invoices_payment_method 
  ON invoices (payment_method_id, imported_by);

-- =====================================================
-- 2. Create Credit Matching Function
-- =====================================================
-- This function matches credits to invoices on the database side
-- Returns array of matched credit IDs with their invoice IDs

CREATE OR REPLACE FUNCTION match_credits_to_invoices(
  p_credits JSONB  -- Array of credits: [{id, reference, payment_method_id, gateway_name}]
)
RETURNS TABLE (
  credit_id UUID,
  invoice_id UUID,
  match_type TEXT,  -- 'exact' or 'gateway_fallback'
  invoice_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  credit_record JSONB;
  matched_invoice RECORD;
  v_reference TEXT;
  v_payment_method_id UUID;
  v_gateway_name TEXT;
BEGIN
  -- Loop through each credit
  FOR credit_record IN SELECT * FROM jsonb_array_elements(p_credits)
  LOOP
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
      -- Return exact match
      credit_id := (credit_record->>'id')::UUID;
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
        -- Return gateway fallback match
        credit_id := (credit_record->>'id')::UUID;
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION match_credits_to_invoices(JSONB) TO authenticated;

-- =====================================================
-- 3. Create helper function to get invoice by reference
-- =====================================================
-- Quick lookup function for single invoice by reference

CREATE OR REPLACE FUNCTION get_invoice_by_reference(
  p_reference TEXT,
  p_payment_method_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  invoice_number TEXT,
  payment_method_id UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    id,
    invoice_number,
    payment_method_id
  FROM invoice_lookup
  WHERE reference = p_reference
    AND imported_by = auth.uid()
    AND (p_payment_method_id IS NULL OR payment_method_id = p_payment_method_id)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_invoice_by_reference(TEXT, UUID) TO authenticated;

-- =====================================================
-- 4. Add comment for documentation
-- =====================================================

COMMENT ON VIEW invoice_lookup IS 'Optimized view for invoice lookups with pre-extracted reference';
COMMENT ON FUNCTION match_credits_to_invoices IS 'Matches credits to invoices using two-level matching: exact (reference+method) and fallback (reference+gateway name)';
COMMENT ON FUNCTION get_invoice_by_reference IS 'Quick lookup for a single invoice by reference and optional payment method';

-- =====================================================
-- Migration Complete
-- =====================================================
-- To use the matching function from your app:
-- 
-- const { data } = await supabase.rpc('match_credits_to_invoices', {
--   p_credits: [
--     {id: 'uuid', reference: 'INV001', payment_method_id: 'uuid', gateway_name: 'Paymob'},
--     {id: 'uuid', reference: 'INV002', payment_method_id: 'uuid', gateway_name: 'Cash'}
--   ]
-- });
-- =====================================================

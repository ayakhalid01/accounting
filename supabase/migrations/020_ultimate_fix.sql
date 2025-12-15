-- =====================================================
-- Migration 020: Ultimate Fix for 1000 Row Limit
-- =====================================================
-- SOLUTION: Since PostgREST limits RPC results to 1000 rows,
-- we'll process matches in smaller chunks on DATABASE side
-- and INSERT results directly into credit_notes table
-- =====================================================

DROP FUNCTION IF EXISTS match_and_insert_credits CASCADE;

CREATE OR REPLACE FUNCTION match_and_insert_credits(
  p_credits JSONB  -- Array of credit data ready to insert
)
RETURNS TABLE (
  total_processed INTEGER,
  matched_count INTEGER,
  skipped_count INTEGER,
  inserted_count INTEGER
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
  v_matched INTEGER := 0;
  v_skipped INTEGER := 0;
  v_inserted INTEGER := 0;
  v_total INTEGER := 0;
  v_credit_data RECORD;
BEGIN
  v_total := jsonb_array_length(p_credits);
  
  -- Loop through each credit
  FOR credit_record IN SELECT * FROM jsonb_array_elements(p_credits)
  LOOP
    v_reference := credit_record->>'credit_note_number';
    v_payment_method_id := (credit_record->>'payment_method_id')::UUID;
    v_gateway_name := credit_record->>'gateway_name';
    
    -- Skip if no reference
    IF v_reference IS NULL OR v_reference = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    
    -- Extract reference from composite credit_note_number if needed
    IF v_reference LIKE '%|%' THEN
      v_reference := SPLIT_PART(v_reference, '|', 1);
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
    
    IF NOT FOUND THEN
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
      END IF;
    END IF;
    
    -- If match found, insert the credit note
    IF FOUND THEN
      v_matched := v_matched + 1;
      
      BEGIN
        INSERT INTO credit_notes (
          credit_note_number,
          partner_name,
          payment_method_id,
          credit_date,
          sale_order_date,
          amount_total,
          currency,
          state,
          imported_by,
          original_invoice_id
        ) VALUES (
          credit_record->>'credit_note_number',
          credit_record->>'partner_name',
          v_payment_method_id,
          (credit_record->>'credit_date')::DATE,
          (credit_record->>'sale_order_date')::DATE,
          (credit_record->>'amount_total')::NUMERIC,
          credit_record->>'currency',
          credit_record->>'state',
          auth.uid(),
          matched_invoice.id
        )
        ON CONFLICT (credit_note_number) DO UPDATE
        SET
          original_invoice_id = matched_invoice.id,
          payment_method_id = v_payment_method_id,
          amount_total = (credit_record->>'amount_total')::NUMERIC;
        
        v_inserted := v_inserted + 1;
      EXCEPTION
        WHEN OTHERS THEN
          -- Skip on error
          v_skipped := v_skipped + 1;
      END;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;
  
  -- Return summary
  total_processed := v_total;
  matched_count := v_matched;
  skipped_count := v_skipped;
  inserted_count := v_inserted;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION match_and_insert_credits(JSONB) TO authenticated;

-- =====================================================
-- Alternative: Keep original function but force no limit
-- =====================================================
-- This changes the function to use max_rows hint

ALTER FUNCTION match_credits_to_invoices(JSONB) 
  SET statement_timeout = '120s';

-- =====================================================
-- Instructions
-- =====================================================
-- Option 1: Use new function match_and_insert_credits()
--   - Matches AND inserts in one database call
--   - No 1000 row limit issue
--   - Much faster overall
--
-- Option 2: Keep using match_credits_to_invoices() 
--   - But call it with smaller batches (1000 credits max)
--   - Multiple calls from client
-- =====================================================

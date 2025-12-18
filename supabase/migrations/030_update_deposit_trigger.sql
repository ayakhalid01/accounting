-- =====================================================
-- Migration 030: Update Deposit Trigger for Allocations
-- =====================================================
-- Purpose: Call populate_deposit_allocations when deposit approved
-- Replaces old calculate_deposit_allocation trigger
-- =====================================================

-- 1. Drop old trigger and function
DROP TRIGGER IF EXISTS trigger_calculate_deposit_allocation ON deposits;
DROP TRIGGER IF EXISTS calculate_deposit_allocation ON deposits;
DROP FUNCTION IF EXISTS calculate_deposit_allocation() CASCADE;

-- 2. Create FAST summary calculation function (for approve action)
-- This calculates ONLY the gap that THIS deposit covers (FIFO aware)
CREATE OR REPLACE FUNCTION calculate_deposit_summary(p_deposit_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_deposit RECORD;
  v_remaining NUMERIC := 0;
  v_total_allocated NUMERIC := 0;
  v_total_gap_avail NUMERIC := 0;
  v_method RECORD;
  v_pmid uuid;
  v_gap numeric;
BEGIN
  -- Get deposit details including method_group
  SELECT id, start_date, end_date, net_amount, payment_method_id, method_group, status, created_at
  INTO v_deposit
  FROM deposits
  WHERE id = p_deposit_id;

  IF v_deposit.status != 'approved' THEN
    RETURN;
  END IF;

  v_remaining := v_deposit.net_amount;

  -- Iterate methods in order from method_group if present, otherwise use payment_method_id
  FOR v_method IN
    SELECT elem
    FROM jsonb_array_elements(
    COALESCE(NULLIF(v_deposit.method_group::jsonb, '[]'::jsonb), jsonb_build_array(jsonb_build_object('payment_method_id', v_deposit.payment_method_id::text)))
  ) AS t(elem)
  LOOP
    -- read payment_method_id (may be text in JSON)
    v_pmid := NULL;
    BEGIN
      v_pmid := (v_method.elem ->> 'payment_method_id')::uuid;
    EXCEPTION WHEN others THEN
      v_pmid := NULL;
    END;

    -- Compute gap available for this method (exclude current deposit id to avoid double-counting)
    v_gap := calculate_gap_in_period(v_deposit.start_date, v_deposit.end_date, v_pmid, p_deposit_id, TRUE);
    v_gap := GREATEST(0, COALESCE(v_gap, 0));

    -- sum total available
    v_total_gap_avail := v_total_gap_avail + v_gap;

    -- allocate as much as we can from remaining, but skip methods with zero gap
    IF v_remaining > 0 AND v_gap > 0 THEN
      IF v_remaining <= v_gap THEN
        v_total_allocated := v_total_allocated + v_remaining;
        v_remaining := 0;
      ELSE
        v_total_allocated := v_total_allocated + v_gap;
        v_remaining := v_remaining - v_gap;
      END IF;
    END IF;

    -- log step for debugging
    INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
    VALUES (v_deposit.start_date, v_deposit.end_date, v_pmid, p_deposit_id, 'summary_allocation_step', v_gap);

  END LOOP;

  -- Update deposit summary columns
  UPDATE deposits
  SET 
    gap_covered = v_total_allocated,
    gap_uncovered = GREATEST(0, v_total_gap_avail - v_total_allocated),
    remaining_amount = GREATEST(0, v_remaining)
  WHERE id = p_deposit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_deposit_summary(UUID) TO authenticated;

-- 3. Create new trigger function (FAST version)
CREATE OR REPLACE FUNCTION trigger_populate_deposit_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- When a deposit transitions to APPROVED, run the summary AND populate detailed allocations.
  -- NOTE: populate_deposit_allocations is potentially expensive; calling it synchronously means the
  -- approving transaction may take longer. This makes allocations immediately available but risks
  -- higher latency during approval.
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    RAISE NOTICE 'Deposit % approved, calculating summary and populating allocations', NEW.id;
    PERFORM calculate_deposit_summary(NEW.id);
    -- Populate detailed per-day allocations for this deposit
    PERFORM populate_deposit_allocations(NEW.id);
  END IF;

  -- If deposit unapproved, delete allocations and reset
  IF NEW.status != 'approved' AND OLD.status = 'approved' THEN
    RAISE NOTICE 'Deposit % unapproved, deleting allocations', NEW.id;
    DELETE FROM deposit_allocations WHERE deposit_id = NEW.id;
    
    -- Reset summary columns
    NEW.gap_covered := 0;
    NEW.gap_uncovered := 0;
    NEW.remaining_amount := NEW.net_amount;
  END IF;

  -- If key fields changed on an already approved deposit, recalculate summary AND repopulate allocations
  IF NEW.status = 'approved' AND OLD.status = 'approved' THEN
    IF NEW.start_date != OLD.start_date 
       OR NEW.end_date != OLD.end_date 
       OR NEW.net_amount != OLD.net_amount 
       OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id THEN
      RAISE NOTICE 'Deposit % changed, recalculating summary and repopulating allocations', NEW.id;
      PERFORM calculate_deposit_summary(NEW.id);
      PERFORM populate_deposit_allocations(NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Create trigger (drop if exists first)
DROP TRIGGER IF EXISTS trigger_populate_deposit_allocations ON deposits;

CREATE TRIGGER trigger_populate_deposit_allocations
  AFTER INSERT OR UPDATE ON deposits
  FOR EACH ROW
  EXECUTE FUNCTION trigger_populate_deposit_allocations();

-- 5. Initial summary calculation for existing approved deposits (FAST)
DO $$
DECLARE
  v_deposit_id UUID;
  v_count INT := 0;
BEGIN
  RAISE NOTICE 'Calculating summaries for existing approved deposits...';
  
  FOR v_deposit_id IN 
    SELECT id 
    FROM deposits 
    WHERE status = 'approved'
    ORDER BY start_date, created_at
  LOOP
    PERFORM calculate_deposit_summary(v_deposit_id);
    v_count := v_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Calculated summaries for % deposits', v_count;
END;
$$;

-- 6. Add comment explaining the approach
COMMENT ON FUNCTION calculate_deposit_summary(UUID) IS 
'Fast summary calculation for deposit approval. Allocates across ordered method_group sequentially: for each method compute available gap (using calculate_gap_in_period) and consume deposit amount in order, skipping methods with zero gap. Updates gap_covered, gap_uncovered, remaining_amount.';

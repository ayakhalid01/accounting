-- 043_method_group_allocation_fix.sql
-- Update calculate_deposit_allocation trigger to allocate across ordered method_group

CREATE OR REPLACE FUNCTION calculate_deposit_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_total_gap_avail NUMERIC := 0;
  v_total_gap_covered NUMERIC := 0;
  v_remaining NUMERIC := 0;
  v_gap NUMERIC := 0;
  v_method RECORD;
  v_pmid uuid;
  v_idx INT := 0;
BEGIN
  -- Only calculate when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN

    v_remaining := NEW.net_amount;

    -- Iterate methods in order from method_group if present, otherwise use payment_method_id
    FOR v_method IN
      SELECT elem
      FROM jsonb_array_elements(
      COALESCE(NULLIF(NEW.method_group::jsonb, '[]'::jsonb), jsonb_build_array(jsonb_build_object('payment_method_id', NEW.payment_method_id::text)))
    ) AS t(elem)
    LOOP
      v_idx := v_idx + 1;

      -- read payment_method_id (may be text in JSON)
      v_pmid := NULL;
      BEGIN
        v_pmid := (v_method.elem ->> 'payment_method_id')::uuid;
      EXCEPTION WHEN others THEN
        v_pmid := NULL;
      END;

      -- Compute gap available for this method (exclude current deposit id to avoid double-counting)
      v_gap := calculate_gap_in_period(NEW.start_date, NEW.end_date, v_pmid, NEW.id);

      -- sum total available
      v_total_gap_avail := v_total_gap_avail + GREATEST(0, v_gap);

      -- allocate as much as we can from remaining
      IF v_remaining > 0 THEN
        IF v_remaining <= v_gap THEN
          v_total_gap_covered := v_total_gap_covered + v_remaining;
          v_remaining := 0;
        ELSE
          v_total_gap_covered := v_total_gap_covered + v_gap;
          v_remaining := v_remaining - v_gap;
        END IF;
      END IF;

      -- optional: write a per-method log row for debugging
      INSERT INTO deposit_gap_logs(start_date, end_date, payment_method_id, exclude_deposit_id, source, gap_value)
      VALUES (NEW.start_date, NEW.end_date, v_pmid, NEW.id, 'allocation_step', v_gap);

    END LOOP;

    -- Set computed values on NEW
    NEW.gap_covered := v_total_gap_covered;
    NEW.remaining_amount := GREATEST(0, v_remaining);
    NEW.gap_uncovered := GREATEST(0, v_total_gap_avail - v_total_gap_covered);

    RAISE NOTICE 'Deposit % allocated: covered=%, remaining=%, total_avail=%', NEW.id, NEW.gap_covered, NEW.remaining_amount, v_total_gap_avail;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_deposit_allocation() TO authenticated;
COMMENT ON FUNCTION calculate_deposit_allocation IS 'Trigger to allocate deposit across ordered method_group, summing gap from calculate_gap_in_period and logging steps.';

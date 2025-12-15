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
  v_total_sales NUMERIC := 0;
  v_older_deposits_covered NUMERIC := 0;
  v_remaining_gap NUMERIC := 0;
  v_total_allocated NUMERIC := 0;
  v_uncovered_gap NUMERIC := 0;
BEGIN
  -- Get deposit details including created_at for FIFO
  SELECT id, start_date, end_date, net_amount, payment_method_id, status, created_at
  INTO v_deposit
  FROM deposits
  WHERE id = p_deposit_id;

  IF v_deposit.status != 'approved' THEN
    RETURN;
  END IF;

  -- Calculate total sales in period (fast aggregation)
  SELECT 
    COALESCE(SUM(i.amount_total), 0) - COALESCE(SUM(c.amount_total), 0)
  INTO v_total_sales
  FROM (
    SELECT COALESCE(SUM(amount_total), 0) as amount_total
    FROM invoices
    WHERE state = 'posted'
      AND sale_order_date::DATE BETWEEN v_deposit.start_date AND v_deposit.end_date
      AND payment_method_id = v_deposit.payment_method_id
  ) i,
  (
    SELECT COALESCE(SUM(ABS(amount_total)), 0) as amount_total
    FROM credit_notes
    WHERE state = 'posted'
      AND original_invoice_id IS NOT NULL
      AND sale_order_date::DATE BETWEEN v_deposit.start_date AND v_deposit.end_date
      AND payment_method_id = v_deposit.payment_method_id
  ) c;

  -- Calculate how much OLDER deposits already covered (FIFO)
  SELECT COALESCE(SUM(d.gap_covered), 0)
  INTO v_older_deposits_covered
  FROM deposits d
  WHERE d.status = 'approved'
    AND d.id != p_deposit_id
    AND d.payment_method_id = v_deposit.payment_method_id
    -- Older deposits (FIFO): started earlier OR started same day but created earlier
    AND (d.start_date < v_deposit.start_date OR (d.start_date = v_deposit.start_date AND d.created_at < v_deposit.created_at))
    -- Overlapping period
    AND d.start_date <= v_deposit.end_date
    AND d.end_date >= v_deposit.start_date;

  -- Calculate remaining gap after older deposits
  v_remaining_gap := GREATEST(0, v_total_sales - v_older_deposits_covered);
  
  -- This deposit covers as much of the remaining gap as possible
  v_total_allocated := LEAST(v_deposit.net_amount, v_remaining_gap);
  
  -- Calculate uncovered gap AFTER this deposit
  v_uncovered_gap := GREATEST(0, v_remaining_gap - v_total_allocated);

  -- Update deposit summary (FAST - no detailed allocation)
  UPDATE deposits
  SET 
    gap_covered = v_total_allocated,
    gap_uncovered = v_uncovered_gap,
    remaining_amount = v_deposit.net_amount - v_total_allocated
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
  -- Only calculate summary when status changes to approved (FAST)
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    RAISE NOTICE 'Deposit % approved, calculating summary', NEW.id;
    PERFORM calculate_deposit_summary(NEW.id);
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

  -- If key fields changed on approved deposit, recalculate summary
  IF NEW.status = 'approved' AND OLD.status = 'approved' THEN
    IF NEW.start_date != OLD.start_date 
       OR NEW.end_date != OLD.end_date 
       OR NEW.net_amount != OLD.net_amount 
       OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id THEN
      RAISE NOTICE 'Deposit % changed, recalculating summary', NEW.id;
      PERFORM calculate_deposit_summary(NEW.id);
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
'Fast summary calculation for deposit approval. Only calculates gap_covered, gap_uncovered, remaining_amount. 
Detailed day-by-day allocations are populated on-demand by calling populate_deposit_allocations() or recalculate_all_deposit_allocations().';

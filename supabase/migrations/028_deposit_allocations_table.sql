-- =====================================================
-- Migration 028: Deposit Allocations Materialized Table
-- =====================================================
-- Purpose: Store pre-calculated day-by-day waterfall allocations
-- Benefits: Fast queries, true FIFO, handles large datasets
-- =====================================================

-- 1. Create deposit_allocations table
CREATE TABLE IF NOT EXISTS deposit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id UUID NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  allocation_date DATE NOT NULL,
  payment_method_id UUID REFERENCES payment_methods(id),
  
  -- Daily metrics
  daily_sales NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  allocated_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  daily_gap NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  
  -- Running balance for this deposit on this day
  deposit_balance_start NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  deposit_balance_end NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_deposit_date UNIQUE (deposit_id, allocation_date),
  CONSTRAINT positive_sales CHECK (daily_sales >= 0),
  CONSTRAINT positive_allocated CHECK (allocated_amount >= 0),
  CONSTRAINT positive_gap CHECK (daily_gap >= 0)
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_deposit_allocations_deposit_id 
  ON deposit_allocations(deposit_id);

CREATE INDEX IF NOT EXISTS idx_deposit_allocations_date 
  ON deposit_allocations(allocation_date);

CREATE INDEX IF NOT EXISTS idx_deposit_allocations_payment_method 
  ON deposit_allocations(payment_method_id);

CREATE INDEX IF NOT EXISTS idx_deposit_allocations_date_method 
  ON deposit_allocations(allocation_date, payment_method_id);

-- 3. Enable RLS
ALTER TABLE deposit_allocations ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Users can view deposit allocations"
  ON deposit_allocations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert deposit allocations"
  ON deposit_allocations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update deposit allocations"
  ON deposit_allocations FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete deposit allocations"
  ON deposit_allocations FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- 5. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON deposit_allocations TO authenticated;

-- 6. Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_deposit_allocations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_deposit_allocations_updated_at
  BEFORE UPDATE ON deposit_allocations
  FOR EACH ROW
  EXECUTE FUNCTION update_deposit_allocations_updated_at();

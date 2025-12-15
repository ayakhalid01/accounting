-- Create payment_method_deposit_settings table
CREATE TABLE IF NOT EXISTS payment_method_deposit_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id) ON DELETE CASCADE,
  
  -- Filter Configuration
  filter_column_name TEXT,
  filter_include_values TEXT[],
  
  -- Amount Configuration
  amount_column_name TEXT NOT NULL,
  refund_column_name TEXT,
  
  -- Tax Configuration
  tax_enabled BOOLEAN DEFAULT false,
  tax_method TEXT CHECK (tax_method IN ('fixed_percent', 'fixed_amount', 'column_based', 'none')) DEFAULT 'none',
  tax_value NUMERIC,
  tax_column_name TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Ensure one setting per payment method
  UNIQUE(payment_method_id)
);

-- Create index for faster lookups
CREATE INDEX idx_deposit_settings_payment_method 
  ON payment_method_deposit_settings(payment_method_id);

-- Create deposits table to store submitted deposits
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  
  -- Date Range
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  -- File Information
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_columns TEXT[],
  total_rows_in_file INTEGER,
  
  -- Configuration Applied
  filter_column_name TEXT,
  filter_include_values TEXT[],
  amount_column_name TEXT NOT NULL,
  refund_column_name TEXT,
  
  -- Calculations
  rows_after_filter INTEGER,
  total_amount NUMERIC NOT NULL,
  total_refunds NUMERIC DEFAULT 0,
  net_amount NUMERIC NOT NULL,
  tax_method TEXT,
  tax_amount NUMERIC DEFAULT 0,
  final_amount NUMERIC NOT NULL,
  
  -- Tax Configuration
  tax_enabled BOOLEAN DEFAULT false,
  tax_value NUMERIC,
  tax_column_name TEXT,
  
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  notes TEXT,
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for deposits
CREATE INDEX idx_deposits_payment_method ON deposits(payment_method_id);
CREATE INDEX idx_deposits_created_by ON deposits(created_by);
CREATE INDEX idx_deposits_status ON deposits(status);

-- Enable RLS on both tables
ALTER TABLE payment_method_deposit_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment_method_deposit_settings (all users can read, admins can write)
CREATE POLICY "Anyone can read deposit settings"
  ON payment_method_deposit_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert deposit settings"
  ON payment_method_deposit_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

CREATE POLICY "Only admins can update deposit settings"
  ON payment_method_deposit_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- RLS Policies for deposits (all users can read, all can insert, only creator/admin can update)
CREATE POLICY "Anyone can read deposits"
  ON deposits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert deposits"
  ON deposits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "Users can update their own deposits or admins can update any"
  ON deposits FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  )
  WITH CHECK (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_deposit_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_deposit_settings_updated_at
BEFORE UPDATE ON payment_method_deposit_settings
FOR EACH ROW
EXECUTE FUNCTION update_deposit_settings_updated_at();

CREATE TRIGGER trigger_deposits_updated_at
BEFORE UPDATE ON deposits
FOR EACH ROW
EXECUTE FUNCTION update_deposits_updated_at();

CREATE OR REPLACE FUNCTION update_deposits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

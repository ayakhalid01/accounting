-- Migration 012: Add deposits table with approval system
-- Created: 2025-12-10

-- Create deposits table
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES payment_methods(id),
  
  -- Date range for deposit
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  -- Financial details
  total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0, -- total + tax
  
  -- Payment method used
  payment_method_name TEXT,
  
  -- Supporting files
  proof_file_url TEXT,
  proof_file_name TEXT,
  
  -- Status and approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  
  -- Approval tracking
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_deposits_user ON deposits(user_id);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_dates ON deposits(start_date, end_date);
CREATE INDEX idx_deposits_payment_method ON deposits(payment_method_id);

-- RLS Policies
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

-- Users can view their own deposits
CREATE POLICY "Users can view own deposits"
  ON deposits FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own deposits
CREATE POLICY "Users can insert own deposits"
  ON deposits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending deposits
CREATE POLICY "Users can update own pending deposits"
  ON deposits FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins can view all deposits
CREATE POLICY "Admins can view all deposits"
  ON deposits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Admins can update all deposits (for approval/rejection)
CREATE POLICY "Admins can update all deposits"
  ON deposits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Add comment
COMMENT ON TABLE deposits IS 'Stores deposit requests from users with approval workflow for admins';

-- Allow users to create payment methods and accountants to delete invoices/credits
-- Migration: 015_allow_users_create_payment_methods
-- Created: 2025-12-10
-- Description: Allow users to create new payment methods during upload if not found
--              Allow accountants to delete invoices/credits when using delete checkbox

-- ==================== Payment Methods ====================

-- Drop old INSERT policy
DROP POLICY IF EXISTS "Admins can insert payment methods" ON payment_methods;

-- Allow all authenticated users to insert payment methods
CREATE POLICY "Authenticated users can insert payment methods"
  ON payment_methods FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ==================== Invoices & Credits Delete ====================

-- Drop old DELETE policies
DROP POLICY IF EXISTS "Admins can delete invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can delete credit notes" ON credit_notes;

-- Allow accountants and admins to delete invoices
CREATE POLICY "Accountants can delete invoices"
  ON invoices FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'accountant') 
      AND is_active = true
    )
  );

-- Allow accountants and admins to delete credit notes
CREATE POLICY "Accountants can delete credit notes"
  ON credit_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'accountant') 
      AND is_active = true
    )
  );

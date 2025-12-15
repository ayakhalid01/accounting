-- Migration: Allow authenticated users to insert invoices and credit notes
-- Date: 2025-12-10

-- Allow all authenticated users to insert invoices
DROP POLICY IF EXISTS "Users can insert invoices" ON invoices;
CREATE POLICY "Users can insert invoices"
  ON invoices FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow all authenticated users to update invoices
DROP POLICY IF EXISTS "Users can update invoices" ON invoices;
CREATE POLICY "Users can update invoices"
  ON invoices FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow all authenticated users to insert credit notes
DROP POLICY IF EXISTS "Users can insert credit notes" ON credit_notes;
CREATE POLICY "Users can insert credit notes"
  ON credit_notes FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow all authenticated users to update credit notes
DROP POLICY IF EXISTS "Users can update credit notes" ON credit_notes;
CREATE POLICY "Users can update credit notes"
  ON credit_notes FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Verify policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename IN ('invoices', 'credit_notes')
ORDER BY tablename, policyname;

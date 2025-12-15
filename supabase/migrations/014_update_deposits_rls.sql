-- Migration 014: Update deposits RLS policies to allow users to view all deposits
-- Created: 2025-12-10

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own deposits" ON deposits;
DROP POLICY IF EXISTS "Admins can view all deposits" ON deposits;

-- New policy: All authenticated users can view all deposits
CREATE POLICY "Users can view all deposits"
ON deposits FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Users can only insert their own deposits
DROP POLICY IF EXISTS "Users can insert own deposits" ON deposits;
CREATE POLICY "Users can insert own deposits"
ON deposits FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can only update their own pending deposits
DROP POLICY IF EXISTS "Users can update own pending deposits" ON deposits;
CREATE POLICY "Users can update own pending deposits"
ON deposits FOR UPDATE
USING (
  auth.uid() = user_id AND
  status = 'pending'
)
WITH CHECK (
  auth.uid() = user_id AND
  status = 'pending'
);

-- Users can only delete their own pending deposits
DROP POLICY IF EXISTS "Users can delete own pending deposits" ON deposits;
CREATE POLICY "Users can delete own pending deposits"
ON deposits FOR DELETE
USING (
  auth.uid() = user_id AND
  status = 'pending'
);

-- Admins can update any deposit (for approval/rejection)
DROP POLICY IF EXISTS "Admins can update all deposits" ON deposits;
CREATE POLICY "Admins can update all deposits"
ON deposits FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'admin'
  )
);

COMMENT ON POLICY "Users can view all deposits" ON deposits IS 'All users can view all deposits from all users';
COMMENT ON POLICY "Users can update own pending deposits" ON deposits IS 'Users can edit only their own pending deposits';
COMMENT ON POLICY "Users can delete own pending deposits" ON deposits IS 'Users can delete only their own pending deposits';

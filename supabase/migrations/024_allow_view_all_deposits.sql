-- =====================================================
-- Migration 024: Allow All Users to View All Deposits
-- =====================================================
-- Purpose: Change RLS policy to allow users to see all deposits
-- WARNING: This removes data privacy between users!
-- =====================================================

-- Drop old restrictive policy
DROP POLICY IF EXISTS "Users can view own deposits" ON deposits;

-- Create new policy: All authenticated users can view all deposits
CREATE POLICY "All users can view all deposits"
  ON deposits FOR SELECT
  USING (auth.role() = 'authenticated');

-- Keep other policies unchanged:
-- - Users can only INSERT their own deposits
-- - Users can only UPDATE their own pending deposits
-- - Admins can UPDATE all deposits

-- Note: This allows any logged-in user to see:
-- - All deposits amounts
-- - All deposits dates
-- - All deposits statuses
-- - All users' deposit data

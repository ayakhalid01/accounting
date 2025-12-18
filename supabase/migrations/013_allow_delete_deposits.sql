-- Migration 013: Allow deletes on deposits for owners (pending) and admins
-- Created: 2025-12-17

-- Users can delete their own deposits only if still pending
CREATE POLICY "Users can delete own pending deposits"
  ON deposits FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins can delete any deposit
CREATE POLICY "Admins can delete deposits"
  ON deposits FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

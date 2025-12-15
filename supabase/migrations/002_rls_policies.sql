-- Row Level Security (RLS) Policies
-- Migration: 002_rls_policies
-- Created: 2025-12-09
-- Description: Security policies for role-based access control

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_emails ENABLE ROW LEVEL SECURITY;

-- ==================== Helper Functions ====================

-- Get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user is accountant or admin
CREATE OR REPLACE FUNCTION is_accountant_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() AND role IN ('accountant', 'admin') AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ==================== User Profiles Policies ====================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  USING (is_admin());

-- Admins can insert new users
CREATE POLICY "Admins can create users"
  ON user_profiles FOR INSERT
  WITH CHECK (is_admin());

-- Admins can update all users
CREATE POLICY "Admins can update users"
  ON user_profiles FOR UPDATE
  USING (is_admin());

-- Admins can delete users
CREATE POLICY "Admins can delete users"
  ON user_profiles FOR DELETE
  USING (is_admin());

-- ==================== Payment Methods Policies ====================

-- All authenticated users can view active payment methods
CREATE POLICY "Users can view active payment methods"
  ON payment_methods FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

-- Admins can view all payment methods
CREATE POLICY "Admins can view all payment methods"
  ON payment_methods FOR SELECT
  USING (is_admin());

-- Admins can manage payment methods
CREATE POLICY "Admins can insert payment methods"
  ON payment_methods FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update payment methods"
  ON payment_methods FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete payment methods"
  ON payment_methods FOR DELETE
  USING (is_admin());

-- ==================== Invoices Policies ====================

-- Accountants and admins can view all invoices
CREATE POLICY "Accountants can view invoices"
  ON invoices FOR SELECT
  USING (is_accountant_or_admin());

-- Accountants and admins can import invoices
CREATE POLICY "Accountants can import invoices"
  ON invoices FOR INSERT
  WITH CHECK (is_accountant_or_admin());

-- Only admins can update invoices
CREATE POLICY "Admins can update invoices"
  ON invoices FOR UPDATE
  USING (is_admin());

-- Only admins can delete invoices
CREATE POLICY "Admins can delete invoices"
  ON invoices FOR DELETE
  USING (is_admin());

-- ==================== Credit Notes Policies ====================

-- Accountants and admins can view all credit notes
CREATE POLICY "Accountants can view credit notes"
  ON credit_notes FOR SELECT
  USING (is_accountant_or_admin());

-- Accountants and admins can import credit notes
CREATE POLICY "Accountants can import credit notes"
  ON credit_notes FOR INSERT
  WITH CHECK (is_accountant_or_admin());

-- Only admins can update credit notes
CREATE POLICY "Admins can update credit notes"
  ON credit_notes FOR UPDATE
  USING (is_admin());

-- Only admins can delete credit notes
CREATE POLICY "Admins can delete credit notes"
  ON credit_notes FOR DELETE
  USING (is_admin());

-- ==================== Accounting Uploads Policies ====================

-- Users can view their own uploads
CREATE POLICY "Users can view own uploads"
  ON accounting_uploads FOR SELECT
  USING (created_by = auth.uid());

-- Admins can view all uploads
CREATE POLICY "Admins can view all uploads"
  ON accounting_uploads FOR SELECT
  USING (is_admin());

-- Accountants can create uploads
CREATE POLICY "Accountants can create uploads"
  ON accounting_uploads FOR INSERT
  WITH CHECK (
    is_accountant_or_admin() AND 
    created_by = auth.uid() AND 
    status = 'draft'
  );

-- Users can update their own draft uploads
CREATE POLICY "Users can update own draft uploads"
  ON accounting_uploads FOR UPDATE
  USING (
    created_by = auth.uid() AND 
    status IN ('draft', 'rejected')
  )
  WITH CHECK (
    created_by = auth.uid() AND 
    status IN ('draft', 'submitted', 'rejected')
  );

-- Admins can update any upload (for approval/rejection)
CREATE POLICY "Admins can update all uploads"
  ON accounting_uploads FOR UPDATE
  USING (is_admin());

-- Users can delete their own draft uploads
CREATE POLICY "Users can delete own draft uploads"
  ON accounting_uploads FOR DELETE
  USING (
    created_by = auth.uid() AND 
    status = 'draft'
  );

-- Admins can delete any upload
CREATE POLICY "Admins can delete any upload"
  ON accounting_uploads FOR DELETE
  USING (is_admin());

-- ==================== Upload Files Policies ====================

-- Users can view files for uploads they created
CREATE POLICY "Users can view own upload files"
  ON upload_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_uploads 
      WHERE id = upload_files.upload_id AND created_by = auth.uid()
    )
  );

-- Admins can view all files
CREATE POLICY "Admins can view all files"
  ON upload_files FOR SELECT
  USING (is_admin());

-- Users can upload files to their own uploads
CREATE POLICY "Users can upload files"
  ON upload_files FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM accounting_uploads 
      WHERE id = upload_files.upload_id 
      AND created_by = auth.uid() 
      AND status IN ('draft', 'rejected')
    )
  );

-- Users can delete files from their own draft uploads
CREATE POLICY "Users can delete own files"
  ON upload_files FOR DELETE
  USING (
    uploaded_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM accounting_uploads 
      WHERE id = upload_files.upload_id 
      AND created_by = auth.uid() 
      AND status IN ('draft', 'rejected')
    )
  );

-- Admins can delete any file
CREATE POLICY "Admins can delete any file"
  ON upload_files FOR DELETE
  USING (is_admin());

-- ==================== Audit Logs Policies ====================

-- Admins can view all audit logs
CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (is_admin());

-- System can insert audit logs (via triggers)
CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);

-- No one can update or delete audit logs (immutable)
-- (No policies = no access for UPDATE/DELETE)

-- ==================== Notification Emails Policies ====================

-- Admins can view all notification emails
CREATE POLICY "Admins can view notification emails"
  ON notification_emails FOR SELECT
  USING (is_admin());

-- Admins can manage notification emails
CREATE POLICY "Admins can insert notification emails"
  ON notification_emails FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update notification emails"
  ON notification_emails FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete notification emails"
  ON notification_emails FOR DELETE
  USING (is_admin());

-- ==================== Storage Policies ====================

-- Create storage bucket for accounting files
INSERT INTO storage.buckets (id, name, public)
VALUES ('accounting-files', 'accounting-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for accounting files
CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'accounting-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'accounting-files' AND
    (
      (storage.foldername(name))[1] = auth.uid()::text OR
      is_admin()
    )
  );

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'accounting-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Admins can manage all files"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'accounting-files' AND
    is_admin()
  );

-- ==================== Grant Permissions ====================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;

-- Grant permissions on sequences
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Allow authenticated users to call helper functions
GRANT EXECUTE ON FUNCTION get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_accountant_or_admin() TO authenticated;

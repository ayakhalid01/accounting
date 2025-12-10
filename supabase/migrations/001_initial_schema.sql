-- Accounting Reconciliation System - Database Schema
-- Migration: 001_initial_schema
-- Created: 2025-12-09
-- Description: Core tables for accounting reconciliation with Odoo integration

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==================== User Profiles Table ====================
-- Extends Supabase auth.users with role information
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'accountant')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_active ON user_profiles(is_active);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);

-- ==================== Payment Methods Table ====================
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, -- e.g., 'cash', 'bank_transfer', 'visa'
  type TEXT NOT NULL CHECK (type IN ('paymob', 'manual', 'bank')),
  is_active BOOLEAN DEFAULT true,
  odoo_id TEXT, -- Reference to Odoo payment method ID
  tax_rate DECIMAL(5,2) DEFAULT 0,
  payment_period_days INTEGER DEFAULT 30,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_type ON payment_methods(type);
CREATE INDEX idx_payment_methods_active ON payment_methods(is_active);
CREATE INDEX idx_payment_methods_code ON payment_methods(code);

-- ==================== Invoices Table ====================
-- Stores invoice data imported from Odoo or Excel files
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,
  odoo_invoice_id TEXT, -- Reference to Odoo invoice ID
  partner_name TEXT,
  payment_method_id UUID REFERENCES payment_methods(id),
  invoice_date DATE NOT NULL,
  due_date DATE,
  amount_untaxed DECIMAL(12,2) NOT NULL,
  amount_tax DECIMAL(12,2) DEFAULT 0,
  amount_total DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'EGP',
  state TEXT NOT NULL CHECK (state IN ('draft', 'posted', 'paid', 'cancelled')),
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('invoice', 'credit_note')),
  notes TEXT,
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_payment_method ON invoices(payment_method_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_state ON invoices(state);
CREATE INDEX idx_invoices_type ON invoices(invoice_type);
CREATE INDEX idx_invoices_imported ON invoices(imported_by, imported_at);

-- ==================== Credit Notes Table ====================
-- Separate table for credit notes with reference to original invoice
CREATE TABLE credit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credit_note_number TEXT NOT NULL UNIQUE,
  odoo_credit_note_id TEXT,
  original_invoice_id UUID REFERENCES invoices(id),
  partner_name TEXT,
  payment_method_id UUID REFERENCES payment_methods(id),
  credit_date DATE NOT NULL,
  amount_untaxed DECIMAL(12,2) NOT NULL,
  amount_tax DECIMAL(12,2) DEFAULT 0,
  amount_total DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'EGP',
  state TEXT NOT NULL CHECK (state IN ('draft', 'posted', 'cancelled')),
  reason TEXT,
  notes TEXT,
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_credit_notes_number ON credit_notes(credit_note_number);
CREATE INDEX idx_credit_notes_payment_method ON credit_notes(payment_method_id);
CREATE INDEX idx_credit_notes_date ON credit_notes(credit_date);
CREATE INDEX idx_credit_notes_invoice ON credit_notes(original_invoice_id);

-- ==================== Accounting Uploads Table ====================
-- Main table for accountant file uploads and approval workflow
CREATE TABLE accounting_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Upload Details
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  total_amount DECIMAL(12,2) NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  include_end_date BOOLEAN DEFAULT true,
  
  -- Status & Workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'pending_approval', 'approved', 'rejected')
  ),
  
  -- Users & Timestamps
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES user_profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  
  -- Review Details
  rejection_reason TEXT,
  admin_notes TEXT,
  
  -- Metadata
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_accounting_uploads_status ON accounting_uploads(status);
CREATE INDEX idx_accounting_uploads_payment_method ON accounting_uploads(payment_method_id);
CREATE INDEX idx_accounting_uploads_created_by ON accounting_uploads(created_by);
CREATE INDEX idx_accounting_uploads_date_range ON accounting_uploads(date_from, date_to);
CREATE INDEX idx_accounting_uploads_created_at ON accounting_uploads(created_at);

-- ==================== Upload Files Table ====================
-- Stores files attached to accounting uploads
CREATE TABLE upload_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_id UUID NOT NULL REFERENCES accounting_uploads(id) ON DELETE CASCADE,
  
  -- File Details
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Supabase Storage path
  file_type TEXT NOT NULL CHECK (file_type IN ('excel', 'csv', 'pdf', 'image')),
  file_size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  
  -- File Content Summary (for Excel/CSV)
  rows_count INTEGER,
  columns_count INTEGER,
  preview_data JSONB, -- First few rows for preview
  
  -- Metadata
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  uploaded_by UUID NOT NULL REFERENCES user_profiles(id)
);

CREATE INDEX idx_upload_files_upload ON upload_files(upload_id);
CREATE INDEX idx_upload_files_type ON upload_files(file_type);

-- ==================== Audit Logs Table ====================
-- Comprehensive audit trail for all critical actions
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Action Details
  action_type TEXT NOT NULL CHECK (action_type IN (
    'upload_created', 'upload_edited', 'upload_deleted', 
    'upload_submitted', 'upload_approved', 'upload_rejected',
    'file_uploaded', 'file_deleted', 'file_downloaded',
    'user_created', 'user_updated', 'user_deleted',
    'login', 'logout', 'permission_changed'
  )),
  
  -- Entity Reference
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'accounting_upload', 'upload_file', 'user', 'invoice', 'credit_note', 'payment_method'
  )),
  entity_id UUID,
  
  -- User & Context
  performed_by UUID REFERENCES user_profiles(id),
  ip_address INET,
  user_agent TEXT,
  
  -- Change Details
  old_values JSONB,
  new_values JSONB,
  description TEXT,
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_action ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(performed_by);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ==================== Notification Emails Table ====================
-- Stores email addresses for approval notifications
CREATE TABLE notification_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'upload_submitted', 'upload_approved', 'upload_rejected', 'all'
  )),
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notification_emails_active ON notification_emails(is_active);
CREATE INDEX idx_notification_emails_type ON notification_emails(notification_type);

-- ==================== Functions & Triggers ====================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounting_uploads_updated_at
  BEFORE UPDATE ON accounting_uploads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create audit log automatically
CREATE OR REPLACE FUNCTION create_audit_log()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_logs (action_type, entity_type, entity_id, performed_by, old_values)
    VALUES (
      TG_ARGV[0]::TEXT,
      TG_ARGV[1]::TEXT,
      OLD.id,
      current_setting('app.current_user_id', TRUE)::UUID,
      row_to_json(OLD)
    );
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_logs (action_type, entity_type, entity_id, performed_by, old_values, new_values)
    VALUES (
      TG_ARGV[0]::TEXT,
      TG_ARGV[1]::TEXT,
      NEW.id,
      current_setting('app.current_user_id', TRUE)::UUID,
      row_to_json(OLD),
      row_to_json(NEW)
    );
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_logs (action_type, entity_type, entity_id, performed_by, new_values)
    VALUES (
      TG_ARGV[0]::TEXT,
      TG_ARGV[1]::TEXT,
      NEW.id,
      current_setting('app.current_user_id', TRUE)::UUID,
      row_to_json(NEW)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply audit triggers to accounting_uploads
CREATE TRIGGER audit_accounting_uploads_insert
  AFTER INSERT ON accounting_uploads
  FOR EACH ROW EXECUTE FUNCTION create_audit_log('upload_created', 'accounting_upload');

CREATE TRIGGER audit_accounting_uploads_update
  AFTER UPDATE ON accounting_uploads
  FOR EACH ROW EXECUTE FUNCTION create_audit_log('upload_edited', 'accounting_upload');

CREATE TRIGGER audit_accounting_uploads_delete
  AFTER DELETE ON accounting_uploads
  FOR EACH ROW EXECUTE FUNCTION create_audit_log('upload_deleted', 'accounting_upload');

-- ==================== Views ====================

-- Net Sales View (Invoices - Credit Notes)
CREATE OR REPLACE VIEW net_sales_view AS
SELECT 
  i.id as invoice_id,
  i.invoice_number,
  i.payment_method_id,
  pm.name_en as payment_method_name,
  i.invoice_date,
  i.amount_total as invoice_amount,
  COALESCE(cn.total_credits, 0) as credit_amount,
  i.amount_total - COALESCE(cn.total_credits, 0) as net_amount
FROM invoices i
LEFT JOIN payment_methods pm ON i.payment_method_id = pm.id
LEFT JOIN (
  SELECT original_invoice_id, SUM(amount_total) as total_credits
  FROM credit_notes
  WHERE state = 'posted'
  GROUP BY original_invoice_id
) cn ON i.id = cn.original_invoice_id
WHERE i.state = 'posted' AND i.invoice_type = 'invoice';

-- Dashboard Summary View
CREATE OR REPLACE VIEW dashboard_summary AS
SELECT 
  pm.id as payment_method_id,
  pm.name_en as payment_method,
  DATE_TRUNC('month', i.invoice_date) as month,
  SUM(CASE WHEN i.invoice_type = 'invoice' THEN i.amount_total ELSE 0 END) as total_invoices,
  SUM(CASE WHEN i.invoice_type = 'credit_note' THEN i.amount_total ELSE 0 END) as total_credits,
  SUM(CASE WHEN i.invoice_type = 'invoice' THEN i.amount_total ELSE -i.amount_total END) as net_sales,
  COALESCE(au.approved_deductions, 0) as approved_deductions,
  SUM(CASE WHEN i.invoice_type = 'invoice' THEN i.amount_total ELSE -i.amount_total END) - COALESCE(au.approved_deductions, 0) as net_after_deduction
FROM invoices i
JOIN payment_methods pm ON i.payment_method_id = pm.id
LEFT JOIN (
  SELECT 
    payment_method_id,
    DATE_TRUNC('month', date_from) as month,
    SUM(total_amount) as approved_deductions
  FROM accounting_uploads
  WHERE status = 'approved'
  GROUP BY payment_method_id, DATE_TRUNC('month', date_from)
) au ON pm.id = au.payment_method_id AND DATE_TRUNC('month', i.invoice_date) = au.month
WHERE i.state = 'posted'
GROUP BY pm.id, pm.name_en, DATE_TRUNC('month', i.invoice_date), au.approved_deductions;

-- ==================== Comments ====================
COMMENT ON TABLE user_profiles IS 'User profiles with role-based access control';
COMMENT ON TABLE accounting_uploads IS 'Main table for accounting file uploads with approval workflow';
COMMENT ON TABLE upload_files IS 'Files attached to accounting uploads (bank statements, proofs)';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all system actions';
COMMENT ON TABLE notification_emails IS 'Email addresses for approval notifications';
COMMENT ON TABLE invoices IS 'Invoices imported from Odoo or uploaded files';
COMMENT ON TABLE credit_notes IS 'Credit notes linked to original invoices';
COMMENT ON TABLE payment_methods IS 'Payment methods from Odoo (Cash, Bank Transfer, Visa, etc.)';

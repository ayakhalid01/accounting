-- Seed Data
-- Migration: 003_seed_data
-- Created: 2025-12-09
-- Description: Initial data for testing and development

-- ==================== Payment Methods ====================
INSERT INTO payment_methods (name_ar, name_en, code, type, is_active, tax_rate, payment_period_days) VALUES
  ('نقدي', 'Cash', 'cash', 'manual', true, 0, 0),
  ('تحويل بنكي', 'Bank Transfer', 'bank_transfer', 'bank', true, 0, 30),
  ('فيزا', 'Visa', 'visa', 'paymob', true, 2.5, 14),
  ('ماستركارد', 'Mastercard', 'mastercard', 'paymob', true, 2.5, 14),
  ('فودافون كاش', 'Vodafone Cash', 'vodafone_cash', 'paymob', true, 1.5, 7),
  ('محفظة اتصالات', 'Etisalat Wallet', 'etisalat_wallet', 'paymob', true, 1.5, 7),
  ('أورنج موني', 'Orange Money', 'orange_money', 'paymob', true, 1.5, 7),
  ('فوري', 'Fawry', 'fawry', 'paymob', true, 1.0, 3),
  ('أمان', 'Aman', 'aman', 'paymob', true, 1.0, 3),
  ('فالو', 'Valu', 'valu', 'paymob', true, 3.0, 45);

-- ==================== Admin User ====================
-- Note: This creates a user profile entry.
-- You need to create the actual auth user via Supabase Dashboard or API
-- INSERT INTO auth.users manually after running this migration

-- Example admin user (UUID should match the auth.users id you create)
-- Uncomment and update the UUID after creating user in Supabase Auth
/*
INSERT INTO user_profiles (id, email, full_name, role, is_active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com', 'System Administrator', 'admin', true);
*/

-- ==================== Notification Emails ====================
INSERT INTO notification_emails (email, notification_type, is_active) VALUES
  ('accounting@example.com', 'all', true),
  ('admin@example.com', 'upload_submitted', true);

-- ==================== Sample Invoices (for testing) ====================
-- Note: These require payment_method_id references
-- Uncomment after you have payment methods in your database

/*
INSERT INTO invoices (
  invoice_number, 
  partner_name, 
  payment_method_id, 
  invoice_date, 
  due_date,
  amount_untaxed, 
  amount_tax, 
  amount_total, 
  state, 
  invoice_type
) VALUES
  (
    'INV/2025/0001', 
    'Test Customer 1', 
    (SELECT id FROM payment_methods WHERE code = 'cash' LIMIT 1),
    '2025-01-01',
    '2025-01-31',
    10000.00,
    1400.00,
    11400.00,
    'posted',
    'invoice'
  ),
  (
    'INV/2025/0002', 
    'Test Customer 2', 
    (SELECT id FROM payment_methods WHERE code = 'visa' LIMIT 1),
    '2025-01-05',
    '2025-01-19',
    5000.00,
    700.00,
    5700.00,
    'posted',
    'invoice'
  );
*/

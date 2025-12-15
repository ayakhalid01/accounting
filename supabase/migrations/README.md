# Database Migrations

This folder contains SQL migrations for the Accounting Reconciliation System.

## Migration Order

Run migrations in the following order:

1. **001_initial_schema.sql** - Creates all tables, indexes, triggers, and views
2. **002_rls_policies.sql** - Sets up Row Level Security policies
3. **003_seed_data.sql** - Inserts initial data (payment methods, etc.)

## How to Apply Migrations

### Option 1: Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste each migration file content
4. Click **Run** for each migration in order

### Option 2: Supabase CLI

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

### Option 3: psql Command Line

```bash
psql postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres \
  -f 001_initial_schema.sql

psql postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres \
  -f 002_rls_policies.sql

psql postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres \
  -f 003_seed_data.sql
```

## After Running Migrations

### Create Admin User

1. Go to Supabase Dashboard → Authentication → Users
2. Click **Add User** → Create New User
3. Fill in email and password
4. Copy the user UUID
5. Run this SQL in SQL Editor:

```sql
INSERT INTO user_profiles (id, email, full_name, role, is_active) 
VALUES 
  ('PASTE-USER-UUID-HERE', 'admin@example.com', 'Admin Name', 'admin', true);
```

### Verify Installation

Run these queries to verify everything is set up correctly:

```sql
-- Check tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Check payment methods
SELECT * FROM payment_methods;

-- Check storage bucket
SELECT * FROM storage.buckets WHERE id = 'accounting-files';
```

## Database Schema Overview

### Core Tables

- **user_profiles** - User accounts with roles (admin/accountant)
- **payment_methods** - Payment methods from Odoo
- **invoices** - Invoice records
- **credit_notes** - Credit note records
- **accounting_uploads** - Main upload records with workflow
- **upload_files** - Files attached to uploads
- **audit_logs** - Complete audit trail
- **notification_emails** - Email notification settings

### Security Features

- Row Level Security (RLS) enabled on all tables
- Role-based access control (Admin vs Accountant)
- Secure file storage with folder-based isolation
- Automatic audit logging via triggers

### Views

- **net_sales_view** - Invoice amounts minus credit notes
- **dashboard_summary** - Aggregated data for dashboard

## Troubleshooting

### RLS Policies Not Working

Make sure you're using the authenticated user context:

```sql
-- Test as specific user
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid-here"}';
```

### Storage Bucket Errors

If storage bucket creation fails, create it manually in Dashboard:
- Go to Storage → Create Bucket
- Name: `accounting-files`
- Public: No (unchecked)

### Permission Errors

Grant necessary permissions:

```sql
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
```

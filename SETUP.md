# Setup Instructions

## Step 1: Install Dependencies

```bash
cd accounting-reconciliation
npm install
```

## Step 2: Configure Environment Variables

1. Copy `.env.local.example` to `.env.local`
2. Fill in your Supabase credentials:
   - Go to your Supabase project dashboard
   - Settings → API
   - Copy the Project URL and anon key

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Step 3: Setup Database

1. Go to Supabase Dashboard → SQL Editor
2. Run migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_seed_data.sql`

## Step 4: Create Admin User

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User" and create a new user
3. Copy the user UUID
4. Run this SQL in SQL Editor:

```sql
INSERT INTO user_profiles (id, email, full_name, role, is_active) 
VALUES 
  ('USER-UUID-HERE', 'admin@example.com', 'Admin Name', 'admin', true);
```

## Step 5: Run Development Server

```bash
npm run dev
```

The app will run on http://localhost:3001

## Step 6: Login

Use the credentials you created in Step 4 to login.

## Project Structure

```
accounting-reconciliation/
├── src/
│   ├── app/              # Next.js pages
│   │   ├── dashboard/    # Dashboard page
│   │   ├── uploads/      # Accounting uploads
│   │   ├── invoices/     # Invoice management
│   │   ├── admin/        # Admin panel
│   │   └── settings/     # User settings
│   ├── components/       # Reusable components
│   ├── lib/             # Utilities and helpers
│   │   ├── supabase/    # Supabase client & auth
│   │   └── utils.ts     # Helper functions
│   └── types/           # TypeScript types
├── supabase/
│   └── migrations/      # Database migrations
└── public/              # Static assets
```

## Features Overview

### 1. Dashboard
- Real-time financial statistics
- Sales vs Credits comparison
- Approved deductions tracking
- Visual charts and trends

### 2. Accounting Uploads
- Upload bank statements and proofs
- Link to payment methods
- Workflow: Draft → Submit → Approve/Reject
- File preview and inline editing

### 3. Invoices
- Import from Odoo or Excel files
- Manage invoices and credit notes
- Payment method tracking

### 4. Admin Panel
- Approve/reject uploads
- User management
- Audit logs
- Email notifications

## Next Steps

The basic structure is complete. You can now:

1. Enhance the uploads page with full CRUD operations
2. Add file upload and preview functionality
3. Implement charts using Recharts
4. Add invoice import from Excel/CSV
5. Build the complete admin panel
6. Add email notifications
7. Implement caching and pagination

## Development Tips

- All routes are protected by authentication middleware
- RLS policies ensure data security
- Use the `auth` helper from `@/lib/supabase/auth`
- File uploads go to Supabase Storage bucket `accounting-files`
- Check `src/types/index.ts` for all TypeScript types

## Troubleshooting

### Database Connection Issues
- Verify your Supabase URL and keys in `.env.local`
- Check RLS policies are correctly applied

### Authentication Issues
- Clear browser cookies
- Check user profile exists in `user_profiles` table
- Verify user role is set correctly

### File Upload Issues
- Check storage bucket exists: `accounting-files`
- Verify storage policies are applied
- Check file size limits in Supabase dashboard

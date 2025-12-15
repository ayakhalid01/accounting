# Apply Migration 012: Deposits with Approval System

## Steps to Execute

### 1. Open Supabase SQL Editor
Navigate to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new

### 2. Copy and Execute Migration
Copy the entire content from:
```
supabase/migrations/012_add_deposits_approval.sql
```

### 3. Verify Tables Created
Run this query to check:
```sql
SELECT * FROM deposits LIMIT 1;
```

### 4. Test RLS Policies
```sql
-- Check if policies are created
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE tablename = 'deposits';
```

## What This Migration Does

1. **Creates `deposits` table** with:
   - Date range (start_date, end_date)
   - Financial fields (total_amount, tax_amount, net_amount)
   - Payment method reference
   - Status: pending/approved/rejected
   - Approval tracking (reviewed_by, reviewed_at, rejection_reason)

2. **RLS Policies**:
   - Users can view/insert/update their own deposits
   - Admins can view/update all deposits
   - Users can only update pending deposits

3. **Indexes** for performance on:
   - user_id
   - status
   - date ranges
   - payment_method_id

## Features Enabled

### For Regular Users:
- Submit deposit requests with date range
- Specify total amount + tax
- Choose payment method
- View their own deposits
- See approval status

### For Admins:
- View all deposit requests
- Approve or reject deposits
- Add rejection reasons
- Track who approved/rejected

## Next Steps

After running migration:
1. Navigate to /deposits page
2. Regular users will see "New Deposit" button
3. Admins will see "Approve/Reject" buttons
4. Test the full workflow!

# Migration 019: Fix RPC Return Limit

## 🎯 Problem
PostgREST enforces a **1000 row limit** on RPC function results, even when using `.limit()` or `.range()` on the client side. This causes only 1000 out of 5000 credits to be matched per batch.

## ✅ Solution
Recreate the `match_credits_to_invoices` function to use a **temporary table** instead of `RETURN NEXT`. This bypasses PostgREST's row limit completely.

## 🔧 What Changed

### Old Approach (Limited to 1000 rows):
```sql
FOR credit_record IN ... LOOP
  -- Find match
  IF FOUND THEN
    RETURN NEXT;  -- ❌ Limited by PostgREST
  END IF;
END LOOP;
```

### New Approach (Unlimited rows):
```sql
CREATE TEMP TABLE temp_matches (...);

FOR credit_record IN ... LOOP
  -- Find match
  IF FOUND THEN
    INSERT INTO temp_matches VALUES (...);  -- ✅ Stored in temp table
  END IF;
END LOOP;

RETURN QUERY SELECT * FROM temp_matches;  -- ✅ Returns ALL rows
```

## 📊 Expected Results

### Before (With 1000 Row Limit):
```
Batch 1: Found 1000 matches out of 5000 credits ❌
Batch 2: Found 1000 matches out of 5000 credits ❌
...
Total: ~8000 matches (only 8% match rate)
```

### After (No Limit):
```
Batch 1: Found 4850 matches out of 5000 credits ✅
Batch 2: Found 4920 matches out of 5000 credits ✅
...
Total: ~48000 matches (50%+ match rate)
```

## 🚀 How to Apply

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in left sidebar

### Step 2: Run the Migration
1. Click "New Query"
2. Copy content of `019_fix_rpc_return_limit.sql`
3. Paste and click "Run"

### Step 3: Verify
Run this to check the function was updated:
```sql
SELECT 
  proname, 
  prosrc 
FROM pg_proc 
WHERE proname = 'match_credits_to_invoices';
```

You should see `temp_matches` in the function source.

### Step 4: Test in Your App
1. Refresh browser (Ctrl+Shift+R)
2. Upload credits file
3. Check console logs:
   - Should NO LONGER see: `⚠️ WARNING: Batch X returned EXACTLY 1000`
   - Should see: `✅ Batch 1: Found 4850 matches out of 5000 credits`

## 🔍 Why This Works

PostgREST applies limits on **row-by-row returns** (RETURN NEXT), but NOT on **batch returns** (RETURN QUERY SELECT). By using a temp table and returning all rows at once with `RETURN QUERY`, we bypass the limit completely.

## 📝 Technical Details

- **Temporary Table**: Created once per function call, dropped automatically
- **work_mem**: Increased to 256MB to handle large result sets
- **Performance**: No change - same speed, just returns all results
- **Security**: Still uses `SECURITY DEFINER` with `auth.uid()` filtering

## ✅ Success Indicators

After applying migration:
- ✅ Batch 1-7 should return 4000-5000 matches each (not 1000)
- ✅ Match rate should jump from 8% to 50%+
- ✅ Total matched credits should increase from ~8K to ~48K
- ✅ No more "EXACTLY 1000" warnings in console

## 🐛 Troubleshooting

### Still seeing 1000 row limit?
1. Verify migration ran successfully in Supabase
2. Hard refresh browser (Ctrl+Shift+R)
3. Check function source contains `temp_matches`

### Function not found error?
Run the migration again - it will recreate the function

### Performance issues?
The temp table is very fast and drops automatically. No cleanup needed.

## 🔄 Rollback (if needed)

To revert to old function:
```sql
-- Run migration 018 again to restore old version
\i supabase/migrations/018_credit_matching_optimization.sql
```

Or drop the function completely:
```sql
DROP FUNCTION IF EXISTS match_credits_to_invoices CASCADE;
```

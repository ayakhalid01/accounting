# Migration 018: Credit Matching Optimization

## 🎯 Purpose
This migration eliminates the need to load 188K+ invoices into the browser when matching credits. Instead, all matching happens on the database server using a SQL function.

## 📊 Performance Improvement
- **Before**: Load 188K invoices → 60+ seconds, 500 errors on large offsets
- **After**: Database function → ~1-3 seconds, no client-side loading

## 🚀 How to Apply

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click on "SQL Editor" in the left sidebar

### Step 2: Run the Migration
1. Click "New Query"
2. Copy the entire content of `018_credit_matching_optimization.sql`
3. Paste into the SQL editor
4. Click "Run" or press `Ctrl+Enter`

### Step 3: Verify Installation
Run this query to verify the function was created:
```sql
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name IN ('match_credits_to_invoices', 'get_invoice_by_reference')
  AND routine_schema = 'public';
```

You should see:
- `match_credits_to_invoices` - FUNCTION
- `get_invoice_by_reference` - FUNCTION

## 📝 What This Migration Creates

### 1. Invoice Lookup View (`invoice_lookup`)
Pre-processes invoice numbers for faster matching:
- Extracts reference from composite invoice_number
- Indexed for ultra-fast lookups
- Filters out null/empty invoice numbers

### 2. Match Credits Function (`match_credits_to_invoices`)
Matches credits to invoices using two-level strategy:
- **Level 1**: Exact match (Reference + Payment Method ID)
- **Level 2**: Fallback match (Reference + Gateway Name similarity)

**Input**: Array of credits with reference, payment_method_id, gateway_name
**Output**: Matched credit_id, invoice_id, match_type, invoice_number

### 3. Quick Lookup Function (`get_invoice_by_reference`)
Helper function for single invoice lookups by reference

## 🔧 How It Works

### Old Method (Client-Side)
```typescript
// ❌ Load ALL invoices (188K+) - SLOW!
const { data: allInvoices } = await supabase
  .from('invoices')
  .select('*')
  .range(0, 188000); // 500 Error on large offsets!

// Match in JavaScript
const matches = credits.map(credit => {
  return allInvoices.find(inv => 
    inv.reference === credit.reference && 
    inv.payment_method_id === credit.payment_method_id
  );
});
```

### New Method (Database-Side)
```typescript
// ✅ Send credits to database - FAST!
const { data: matches } = await supabase.rpc('match_credits_to_invoices', {
  p_credits: credits.map(c => ({
    id: c.id,
    reference: c.reference,
    payment_method_id: c.payment_method_id,
    gateway_name: c.gateway_name
  }))
});

// Matches returned instantly from database!
```

## 🎬 Usage Example

```typescript
// Prepare credits array
const creditsToMatch = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    reference: 'INV001',
    payment_method_id: '456e4567-e89b-12d3-a456-426614174111',
    gateway_name: 'Paymob'
  },
  {
    id: '223e4567-e89b-12d3-a456-426614174001',
    reference: 'INV002',
    payment_method_id: '556e4567-e89b-12d3-a456-426614174222',
    gateway_name: 'Cash'
  }
];

// Call database function
const { data: matches, error } = await supabase.rpc(
  'match_credits_to_invoices',
  { p_credits: creditsToMatch }
);

// Result:
// [
//   {
//     credit_id: '123e4567-e89b-12d3-a456-426614174000',
//     invoice_id: '789e4567-e89b-12d3-a456-426614174333',
//     match_type: 'exact',
//     invoice_number: 'INV001|Paymob'
//   },
//   {
//     credit_id: '223e4567-e89b-12d3-a456-426614174001',
//     invoice_id: '889e4567-e89b-12d3-a456-426614174444',
//     match_type: 'gateway_fallback',
//     invoice_number: 'INV002|Cash'
//   }
// ]
```

## 🔍 Testing After Migration

1. Upload invoices file (FullInvoices.xlsx)
2. Upload credits file
3. Check console logs - should show:
   - "🔍 Matching X credits using database function..."
   - "⚡ Matched X credits in 1-3s using database function"
   - No "📥 Loaded X/188833 invoices..." messages

## ✅ Success Indicators
- No 500 errors on large data sets
- Credit matching completes in 1-3 seconds (not 60+ seconds)
- Console shows "using database function" message
- Higher match rate (exact + fallback matching)

## 🐛 Troubleshooting

### Error: "function match_credits_to_invoices does not exist"
- Run the migration SQL file in Supabase SQL Editor
- Make sure to run the entire file, not just parts

### Error: "permission denied for function"
- The migration includes GRANT statements
- If still failing, run: `GRANT EXECUTE ON FUNCTION match_credits_to_invoices TO authenticated;`

### No matches found
- Check that invoices were imported first
- Verify invoice_number format includes reference (e.g., "INV001|Gateway")
- Check payment_methods table has correct gateway names

## 📚 Additional Notes

### Indexes Created
- `idx_invoices_reference` - Fast lookup by extracted reference
- `idx_invoices_payment_method` - Fast lookup by payment method + user

### Security
- Functions use `SECURITY DEFINER` with `auth.uid()` filter
- Only matches invoices imported by the current user
- Proper RLS policies apply

### Performance Tips
- Batch size: Send up to 1000 credits at once for best performance
- For > 1000 credits, split into multiple calls
- Database function is much faster than client-side matching

## 🔄 Rollback (if needed)
```sql
DROP VIEW IF EXISTS invoice_lookup CASCADE;
DROP FUNCTION IF EXISTS match_credits_to_invoices CASCADE;
DROP FUNCTION IF EXISTS get_invoice_by_reference CASCADE;
DROP INDEX IF EXISTS idx_invoices_reference;
DROP INDEX IF EXISTS idx_invoices_payment_method;
```

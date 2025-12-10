# Invoice & Credit Note Import Guide

## Your Requirement: "سأرفعلك INVOICES and credits with structure and schema old to 2 tables"

Based on your requirement to upload invoices and credits to 2 tables, here's the exact structure and import process.

---

## 📊 Database Tables Ready for Your Data

### Table 1: `invoices`

#### Structure:
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,              -- رقم الفاتورة
  odoo_invoice_id TEXT,                            -- Odoo reference (optional)
  partner_name TEXT,                                -- اسم العميل
  payment_method_id UUID REFERENCES payment_methods(id),  -- طريقة الدفع
  invoice_date DATE NOT NULL,                       -- تاريخ الفاتورة
  due_date DATE,                                    -- تاريخ الاستحقاق
  amount_untaxed DECIMAL(12,2) NOT NULL,           -- المبلغ قبل الضريبة
  amount_tax DECIMAL(12,2) DEFAULT 0,              -- قيمة الضريبة
  amount_total DECIMAL(12,2) NOT NULL,             -- المبلغ الإجمالي
  currency TEXT DEFAULT 'EGP',                     -- العملة
  state TEXT NOT NULL CHECK (state IN ('draft', 'posted', 'paid', 'cancelled')),
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('invoice', 'credit_note')),
  notes TEXT,                                       -- ملاحظات
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Table 2: `credit_notes`

#### Structure:
```sql
CREATE TABLE credit_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credit_note_number TEXT NOT NULL UNIQUE,          -- رقم الإشعار الدائن
  odoo_credit_note_id TEXT,                        -- Odoo reference (optional)
  original_invoice_id UUID REFERENCES invoices(id), -- ارتباط بالفاتورة الأصلية
  partner_name TEXT,                                -- اسم العميل
  payment_method_id UUID REFERENCES payment_methods(id),  -- طريقة الدفع
  credit_date DATE NOT NULL,                        -- تاريخ الإشعار
  amount_untaxed DECIMAL(12,2) NOT NULL,           -- المبلغ قبل الضريبة
  amount_tax DECIMAL(12,2) DEFAULT 0,              -- قيمة الضريبة
  amount_total DECIMAL(12,2) NOT NULL,             -- المبلغ الإجمالي
  currency TEXT DEFAULT 'EGP',                     -- العملة
  state TEXT NOT NULL CHECK (state IN ('draft', 'posted', 'cancelled')),
  reason TEXT,                                      -- سبب الإشعار الدائن
  notes TEXT,                                       -- ملاحظات
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 📥 How to Import Your Data

### Method 1: CSV Format (Recommended)

#### Step 1: Prepare Your CSV Files

**invoices.csv:**
```csv
invoice_number,partner_name,payment_method_code,invoice_date,due_date,amount_untaxed,amount_tax,amount_total,state
INV-2025-0001,Customer A,visa,2025-01-01,2025-01-15,10000.00,1400.00,11400.00,posted
INV-2025-0002,Customer B,cash,2025-01-02,2025-01-02,5000.00,700.00,5700.00,posted
INV-2025-0003,Customer C,bank_transfer,2025-01-03,2025-02-03,15000.00,2100.00,17100.00,posted
```

**credit_notes.csv:**
```csv
credit_note_number,invoice_number,partner_name,payment_method_code,credit_date,amount_untaxed,amount_tax,amount_total,state,reason
CN-2025-0001,INV-2025-0001,Customer A,visa,2025-01-10,1000.00,140.00,1140.00,posted,Product return
CN-2025-0002,INV-2025-0002,Customer B,cash,2025-01-12,500.00,70.00,570.00,posted,Discount
```

#### Step 2: Get Payment Method IDs

First, you need to get the payment method IDs from the database:

```sql
-- View all payment methods
SELECT id, code, name_en, name_ar 
FROM payment_methods 
WHERE is_active = true 
ORDER BY name_en;
```

**Result will be:**
```
id                                    | code            | name_en        | name_ar
--------------------------------------|-----------------|----------------|----------
uuid-1                                | cash            | Cash           | نقدي
uuid-2                                | bank_transfer   | Bank Transfer  | تحويل بنكي
uuid-3                                | visa            | Visa           | فيزا
...
```

#### Step 3: Create Import Script

**Option A: SQL Import (Simple)**

```sql
-- Import Invoices
INSERT INTO invoices (
  invoice_number, 
  partner_name, 
  payment_method_id, 
  invoice_date, 
  due_date,
  amount_untaxed, 
  amount_tax, 
  amount_total,
  currency,
  state, 
  invoice_type,
  imported_by
) 
SELECT 
  'INV-2025-0001',
  'Customer A',
  (SELECT id FROM payment_methods WHERE code = 'visa'),
  '2025-01-01'::date,
  '2025-01-15'::date,
  10000.00,
  1400.00,
  11400.00,
  'EGP',
  'posted',
  'invoice',
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1)
UNION ALL
SELECT 
  'INV-2025-0002',
  'Customer B',
  (SELECT id FROM payment_methods WHERE code = 'cash'),
  '2025-01-02'::date,
  '2025-01-02'::date,
  5000.00,
  700.00,
  5700.00,
  'EGP',
  'posted',
  'invoice',
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1);
-- Add more rows...

-- Import Credit Notes
INSERT INTO credit_notes (
  credit_note_number,
  original_invoice_id,
  partner_name,
  payment_method_id,
  credit_date,
  amount_untaxed,
  amount_tax,
  amount_total,
  currency,
  state,
  reason,
  imported_by
)
SELECT 
  'CN-2025-0001',
  (SELECT id FROM invoices WHERE invoice_number = 'INV-2025-0001'),
  'Customer A',
  (SELECT id FROM payment_methods WHERE code = 'visa'),
  '2025-01-10'::date,
  1000.00,
  140.00,
  1140.00,
  'EGP',
  'posted',
  'Product return',
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1);
-- Add more rows...
```

**Option B: Using psql COPY (For Large Files)**

```sql
-- Create temp table
CREATE TEMP TABLE temp_invoices (
  invoice_number TEXT,
  partner_name TEXT,
  payment_method_code TEXT,
  invoice_date DATE,
  due_date DATE,
  amount_untaxed DECIMAL(12,2),
  amount_tax DECIMAL(12,2),
  amount_total DECIMAL(12,2),
  state TEXT
);

-- Import CSV
\COPY temp_invoices FROM 'path/to/invoices.csv' WITH CSV HEADER;

-- Insert into main table
INSERT INTO invoices (
  invoice_number, partner_name, payment_method_id, invoice_date,
  due_date, amount_untaxed, amount_tax, amount_total, state, 
  invoice_type, currency, imported_by
)
SELECT 
  t.invoice_number,
  t.partner_name,
  pm.id,
  t.invoice_date,
  t.due_date,
  t.amount_untaxed,
  t.amount_tax,
  t.amount_total,
  t.state,
  'invoice',
  'EGP',
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1)
FROM temp_invoices t
JOIN payment_methods pm ON pm.code = t.payment_method_code;

-- Verify
SELECT COUNT(*) FROM invoices;
```

---

## 🛠️ Method 2: Build Import Component (Better for Future)

I can build you a React component that:
1. Accepts CSV/Excel file upload
2. Parses the data
3. Shows preview table
4. Validates payment methods
5. Bulk inserts to database

### Component Structure:
```typescript
// src/components/InvoiceImporter.tsx
'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase/client';

export function InvoiceImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target?.result, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      setData(jsonData);
    };
    reader.readAsBinaryString(uploadedFile);
  };

  const handleImport = async () => {
    setLoading(true);
    
    // Get payment method mapping
    const { data: paymentMethods } = await supabase
      .from('payment_methods')
      .select('id, code');
    
    const pmMap = new Map(paymentMethods?.map(pm => [pm.code, pm.id]));
    
    // Transform data
    const invoicesToInsert = data.map(row => ({
      invoice_number: row.invoice_number,
      partner_name: row.partner_name,
      payment_method_id: pmMap.get(row.payment_method_code),
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      amount_untaxed: parseFloat(row.amount_untaxed),
      amount_tax: parseFloat(row.amount_tax),
      amount_total: parseFloat(row.amount_total),
      state: row.state,
      invoice_type: 'invoice',
      currency: 'EGP'
    }));
    
    // Insert
    const { error } = await supabase
      .from('invoices')
      .insert(invoicesToInsert);
    
    if (error) {
      alert('Error: ' + error.message);
    } else {
      alert('Success! Imported ' + data.length + ' invoices');
    }
    
    setLoading(false);
  };

  return (
    <div className="p-6">
      <h2>Import Invoices</h2>
      <input type="file" accept=".csv,.xlsx" onChange={handleFileUpload} />
      
      {data.length > 0 && (
        <div>
          <p>Found {data.length} records</p>
          <button onClick={handleImport} disabled={loading}>
            {loading ? 'Importing...' : 'Import to Database'}
          </button>
          
          {/* Preview table */}
          <table>
            <thead>
              <tr>
                {Object.keys(data[0]).map(key => <th key={key}>{key}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 5).map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((val: any, j) => <td key={j}>{val}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

---

## 📋 Required CSV Columns

### For Invoices:
| Column | Type | Required | Example | Notes |
|--------|------|----------|---------|-------|
| invoice_number | TEXT | ✅ Yes | INV-2025-0001 | Must be unique |
| partner_name | TEXT | ⚠️ Optional | Customer A | Client name |
| payment_method_code | TEXT | ✅ Yes | visa | Must match DB |
| invoice_date | DATE | ✅ Yes | 2025-01-01 | YYYY-MM-DD format |
| due_date | DATE | ⚠️ Optional | 2025-01-15 | YYYY-MM-DD format |
| amount_untaxed | NUMBER | ✅ Yes | 10000.00 | Before tax |
| amount_tax | NUMBER | ⚠️ Optional | 1400.00 | Tax amount |
| amount_total | NUMBER | ✅ Yes | 11400.00 | Total amount |
| state | TEXT | ✅ Yes | posted | draft/posted/paid/cancelled |

### For Credit Notes:
| Column | Type | Required | Example | Notes |
|--------|------|----------|---------|-------|
| credit_note_number | TEXT | ✅ Yes | CN-2025-0001 | Must be unique |
| invoice_number | TEXT | ⚠️ Optional | INV-2025-0001 | Link to original invoice |
| partner_name | TEXT | ⚠️ Optional | Customer A | Client name |
| payment_method_code | TEXT | ✅ Yes | visa | Must match DB |
| credit_date | DATE | ✅ Yes | 2025-01-10 | YYYY-MM-DD format |
| amount_untaxed | NUMBER | ✅ Yes | 1000.00 | Before tax |
| amount_tax | NUMBER | ⚠️ Optional | 140.00 | Tax amount |
| amount_total | NUMBER | ✅ Yes | 1140.00 | Total amount |
| state | TEXT | ✅ Yes | posted | draft/posted/cancelled |
| reason | TEXT | ⚠️ Optional | Product return | Reason for credit note |

---

## ✅ Payment Method Codes

These are the pre-seeded payment methods in your database:

| Code | Name (English) | Name (Arabic) |
|------|----------------|---------------|
| cash | Cash | نقدي |
| bank_transfer | Bank Transfer | تحويل بنكي |
| visa | Visa | فيزا |
| mastercard | Mastercard | ماستركارد |
| vodafone_cash | Vodafone Cash | فودافون كاش |
| etisalat_wallet | Etisalat Wallet | محفظة اتصالات |
| orange_money | Orange Money | أورنج موني |
| fawry | Fawry | فوري |
| aman | Aman | أمان |
| valu | Valu | فالو |

---

## 🔍 Verification Queries

After importing, run these queries to verify:

```sql
-- Count total invoices
SELECT COUNT(*) as total_invoices FROM invoices;

-- Count by payment method
SELECT 
  pm.name_en,
  COUNT(i.id) as invoice_count,
  SUM(i.amount_total) as total_amount
FROM invoices i
JOIN payment_methods pm ON i.payment_method_id = pm.id
GROUP BY pm.name_en
ORDER BY total_amount DESC;

-- Count credit notes
SELECT COUNT(*) as total_credits FROM credit_notes;

-- Net sales (invoices - credits)
SELECT 
  pm.name_en,
  SUM(CASE WHEN i.invoice_type = 'invoice' THEN i.amount_total ELSE 0 END) as invoices,
  COALESCE(cn.credit_total, 0) as credits,
  SUM(CASE WHEN i.invoice_type = 'invoice' THEN i.amount_total ELSE 0 END) - COALESCE(cn.credit_total, 0) as net
FROM invoices i
JOIN payment_methods pm ON i.payment_method_id = pm.id
LEFT JOIN (
  SELECT payment_method_id, SUM(amount_total) as credit_total
  FROM credit_notes
  GROUP BY payment_method_id
) cn ON pm.id = cn.payment_method_id
WHERE i.state = 'posted'
GROUP BY pm.name_en, cn.credit_total;
```

---

## 🚀 Next Steps

1. **Prepare your data** in CSV format
2. **Choose import method:**
   - Quick: Use SQL directly
   - Better: Build the import component
3. **Import your data**
4. **Verify using the queries above**
5. **Dashboard will automatically show the data**

---

## 💡 Want me to build the import component for you?

Just let me know and I can create a complete Invoice/Credit Note importer with:
- ✅ File upload (CSV/Excel)
- ✅ Data preview
- ✅ Validation
- ✅ Bulk insert
- ✅ Progress indicator
- ✅ Error handling

Would take about 30 minutes to implement! 🚀

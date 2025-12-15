# Deposits Tab - New Feature: Advanced Deposit Upload & Auto-Processing

## Overview
This feature enables users to upload deposit files (Excel/CSV) with automatic column mapping, filtering, and amount calculation. To reduce repetitive configuration, settings are stored per payment method and auto-applied when uploading.

---

## Feature Architecture

### Phase 1: Submit New Deposits (Tab)
User uploads file and configures columns for processing.

### Phase 2: Settings (New Tab)
User configures deposit processing rules per payment method (one-time setup).

---

## Detailed Flow

### PHASE 1: Submit New Deposits Tab

#### Step 1: Initial Inputs
```
┌─ Payment Method Selector (dropdown)
├─ Start Date (date picker)
├─ End Date (date picker)
└─ Upload File (Excel/CSV) + "Done Upload" button
```

**Example:**
```
Payment Method: [🔽 Choose...] → Select "Bank Transfer"
Start Date: 2025-12-01
End Date: 2025-12-31
File: [📁 Choose File] → user_deposits_dec.xlsx → "Done Upload" ✓
```

---

#### Step 2: After "Done Upload" - Column Configuration Dropdowns

After file is uploaded, **3 dropdowns appear** (column names extracted from file):

##### Dropdown 1: Filter Column (OPTIONAL)
```
Label: "Filter Column (Optional)"
Options: [🔽 Select Column...]
         → Bank Name
         → Account Type
         → Transaction Type
         → Status
         → (All column names from file)
```

**When a column is selected:**
- Extract all DISTINCT values from that column
- Show as multi-select checkboxes below the dropdown

**Example:**
```
Filter Column: [🔽 Account Type ▼]
Options (check to include):
  ☑ Current Account
  ☐ Savings Account
  ☐ Investment Account
```

---

##### Dropdown 2: Amount Column (REQUIRED after filter)
```
Label: "Choose Column to Sum (Total Amount)"
Options: [🔽 Select Column...]
         → Amount
         → Total
         → Deposit Amount
         → (Numeric columns only)
```

**Example:**
```
Amount Column: [🔽 Total ▼]
```

---

##### Dropdown 3: Refund Column (OPTIONAL)
```
Label: "Choose Column for Refunds/Deductions (Optional)"
Options: [🔽 Select Column...]
         → Refund
         → Discount
         → Fee
         → Deduction
         → (Numeric columns)
```

**Example:**
```
Refund Column: [🔽 Refund ▼]
```

---

#### Step 3: Auto-Calculate Button
```
Button: "Calculate & Process"
├─ Apply filter (if selected)
├─ Sum the Amount Column
├─ Subtract Refund Column (if selected)
└─ Display: Total Amount (EGP): 450,000.00
```

**Example Process:**
```
File: user_deposits_dec.xlsx

Initial Data (5 rows):
┌─────────────────┬──────────┬────────┐
│ Account Type    │ Amount   │ Refund │
├─────────────────┼──────────┼────────┤
│ Current Account │ 100,000  │ 5,000  │
│ Savings Account │ 200,000  │ 10,000 │
│ Current Account │ 150,000  │ 3,000  │
│ Investment Acct │ 50,000   │ 2,000  │
│ Current Account │ 75,000   │ 0      │
└─────────────────┴──────────┴────────┘

USER CONFIGURATION:
- Filter: Account Type = "Current Account"
- Amount Column: Amount
- Refund Column: Refund

AFTER FILTERING (3 rows match):
┌─────────────────┬──────────┬────────┐
│ Account Type    │ Amount   │ Refund │
├─────────────────┼──────────┼────────┤
│ Current Account │ 100,000  │ 5,000  │
│ Current Account │ 150,000  │ 3,000  │
│ Current Account │ 75,000   │ 0      │
└─────────────────┴──────────┴────────┘

CALCULATION:
Sum(Amount) = 100,000 + 150,000 + 75,000 = 325,000
Sum(Refund) = 5,000 + 3,000 + 0 = 8,000
Net Amount = 325,000 - 8,000 = 317,000 EGP

DISPLAY:
✅ Total Amount (EGP): 325,000.00
✅ Total Refunds (EGP): 8,000.00
✅ Net Amount (EGP): 317,000.00
```

---

#### Step 4: Tax Amount (Locked Initially)
```
Tax Amount (EGP): ⚠️ LOCKED (depends on payment method)
├─ Some gateways don't support custom tax
├─ Tax calculation defined in Settings (Phase 2)
└─ If user enabled tax in Settings → becomes editable here
```

---

#### Step 5: Final Buttons
```
┌─ "Save Deposit" (saves to database)
├─ "Save Settings for This Method" (saves config to Settings tab)
└─ "Reset" (clear form)
```

---

## PHASE 2: Settings Tab (Payment Method Configuration)

Store configuration per payment method. When user uploads deposit, settings auto-populate.

### Settings Table Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Payment Method Configuration                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Method: Bank Transfer                                              │
│ Status: [✓ Active]                                                 │
│                                                                     │
│ FILTER CONFIGURATION:                                              │
│ Filter Column: [Account Type]                                      │
│ Default Filter Values:                                             │
│   ☑ Current Account                                                │
│   ☑ Savings Account                                                │
│   ☐ Investment Account                                             │
│                                                                     │
│ AMOUNT CONFIGURATION:                                              │
│ Amount Column: [Total]                                             │
│ Refund Column (Optional): [Refund]                                 │
│                                                                     │
│ TAX CONFIGURATION:                                                 │
│ ☐ Enable Tax Amount                                                │
│   └─ If unchecked: Tax is LOCKED in deposits                       │
│   └─ If checked: Choose tax calculation method:                    │
│      (a) Column from file: [Dropdown] →  [Percent field] or [None] │
│      (b) Write fixed percent: [  2.5  ] %                          │
│      (c) Write fixed amount: [ 50,000 ] EGP                        │
│                                                                     │
│ [Save Settings] [Delete] [Cancel]                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Example Settings for Bank Transfer

```
Payment Method: Bank Transfer
Filter Column: Account Type
Included Accounts: [Current Account, Savings Account]
Amount Column: Total
Refund Column: Refund
Tax Enabled: YES
Tax Method: Fixed Percent = 2.5%
```

### Example Settings for Credit Card

```
Payment Method: Credit Card
Filter Column: (None)
Amount Column: Amount
Refund Column: (None)
Tax Enabled: NO (LOCKED)
```

---

## Auto-Fill Behavior

When user selects payment method in "Submit New Deposits":

```
User Action: Select "Bank Transfer" from dropdown

System Response (Auto-fill):
├─ Filter Column: Account Type ✓
├─ Included Filters: Current Account, Savings Account ✓
├─ Amount Column: Total ✓
├─ Refund Column: Refund ✓
├─ Tax Enabled: YES ✓
└─ Tax Method: 2.5% ✓

Display: "⚡ Configuration auto-loaded from settings"
          [Edit] [Use as is] [Reset to defaults]
```

---

## Tax Amount Calculation Examples

### Tax Method 1: Fixed Percent
```
Scenario: 2.5% tax on net amount after refunds

Net Amount: 317,000 EGP
Tax (2.5%): 317,000 × 0.025 = 7,925 EGP
Total with Tax: 317,000 + 7,925 = 324,925 EGP
```

### Tax Method 2: Fixed Amount
```
Scenario: Flat 5,000 EGP tax

Net Amount: 317,000 EGP
Tax (Fixed): 5,000 EGP
Total with Tax: 317,000 + 5,000 = 322,000 EGP
```

### Tax Method 3: Column-Based (From File)
```
Scenario: Tax from "Tax Amount" column in file

Filtered rows have Tax column:
  Row 1: Tax = 2,000
  Row 2: Tax = 3,000
  Row 3: Tax = 1,500

Total Tax: 2,000 + 3,000 + 1,500 = 6,500 EGP
Net Amount: 317,000 EGP
Total with Tax: 317,000 + 6,500 = 323,500 EGP
```

---

## Database Schema

### Table: `payment_method_deposit_settings`

```sql
CREATE TABLE payment_method_deposit_settings (
  id UUID PRIMARY KEY,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  
  -- Filter Configuration
  filter_column_name TEXT,
  filter_include_values TEXT[] (array of distinct values),
  
  -- Amount Configuration
  amount_column_name TEXT NOT NULL,
  refund_column_name TEXT,
  
  -- Tax Configuration
  tax_enabled BOOLEAN DEFAULT false,
  tax_method TEXT ('fixed_percent' | 'fixed_amount' | 'column_based'),
  tax_value NUMERIC, -- for fixed_percent or fixed_amount
  tax_column_name TEXT, -- for column_based
  
  -- Metadata
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## UI Flow Diagram

```
┌─────────────────────────────────────────┐
│    Submit New Deposits                  │
├─────────────────────────────────────────┤
│ Payment Method: [Bank Transfer ▼]       │
│ Start Date: [2025-12-01]                │
│ End Date: [2025-12-31]                  │
│ File: [upload.xlsx] [Done Upload] ✓    │
└─────────────────────────────────────────┘
              ↓
         File Processed
              ↓
┌─────────────────────────────────────────┐
│ ⚡ Settings Found - Auto-Loading...     │
├─────────────────────────────────────────┤
│ Filter: Account Type                    │
│ ☑ Current Account                       │
│ ☑ Savings Account                       │
│                                         │
│ Amount Column: Total                    │
│ Refund Column: Refund                   │
│ Tax Enabled: YES (2.5%)                 │
│                                         │
│ [Edit Settings] [Use as is]             │
└─────────────────────────────────────────┘
              ↓
     User Confirms/Edits
              ↓
┌─────────────────────────────────────────┐
│ [Calculate & Process]                   │
├─────────────────────────────────────────┤
│ Total Amount (EGP): 325,000.00          │
│ Total Refunds (EGP): 8,000.00           │
│ Net Amount (EGP): 317,000.00            │
│ Tax (2.5%): 7,925.00                    │
│ Final Amount (EGP): 324,925.00          │
│                                         │
│ [Save Deposit] [Save Settings]          │
└─────────────────────────────────────────┘
```

---

## Implementation Checklist

- [ ] **Phase 1a**: Create file upload UI with date/payment method selectors
- [ ] **Phase 1b**: Parse uploaded file and extract column names
- [ ] **Phase 1c**: Create filter dropdown with distinct value extraction
- [ ] **Phase 1d**: Create amount & refund column selectors
- [ ] **Phase 1e**: Implement calculation logic
- [ ] **Phase 1f**: Add tax calculation (initially locked)
- [ ] **Phase 2a**: Create Settings tab UI
- [ ] **Phase 2b**: Create database schema for settings
- [ ] **Phase 2c**: Implement auto-fill from settings
- [ ] **Phase 2d**: Add tax configuration UI
- [ ] **Phase 3**: Add "Save Settings" button in deposits
- [ ] **Phase 4**: Add update/delete settings functionality

---

## Questions to Confirm

1. **Tax Locking**: Which payment methods should have tax LOCKED? (Bank Transfer, Credit Card, etc.?)
2. **Default Filter Values**: Should filter default to "all" or empty?
3. **File Format**: Support both .xlsx and .csv? Any size limits?
4. **Error Handling**: What if user selects non-numeric column for amount?
5. **Settings Inheritance**: Can settings be copied from one method to another?


# Accounting Reconciliation System

## 📋 Features

### Core Modules

1. **Dashboard** - Sales analysis, deposits tracking, period comparisons
2. **Invoices & Credits** - Invoice/credit note search, filtering, export
3. **Deposits Management** - NEW: Upload, configure, and process deposits
4. **Accounting Uploads** - File upload and reconciliation
5. **Admin Panel** - User and system management

---

## 🆕 Deposits Management System

### Overview
A comprehensive deposit file upload and management system with per-payment-method configuration, automatic column mapping, filtering, and calculation.

### Three Main Components:

#### 1. **Deposits Settings** (`/deposits/settings`) - Admin Configuration
- Configure deposit processing rules per payment method
- Define column mappings (filter, amount, refund columns)
- Set default filter values (e.g., account types)
- Configure tax calculation (%, fixed amount, or from file)
- View all configured methods in summary table

#### 2. **Submit New Deposits** (`/deposits/upload`) - User Upload
- Three-phase workflow:
  1. **Upload Phase**: Select payment method, date range, upload Excel/CSV
  2. **Configure Phase**: Select columns, auto-populated from settings
  3. **Review Phase**: Verify calculations and save deposit
- Auto-load settings from saved configuration
- Real-time filtering and calculation
- Save settings for future uploads

#### 3. **Deposits Management** (`/deposits`) - View & Manage
- List submitted deposits
- Filter by payment method, date, status
- View deposit details and calculations
- Approve/reject workflow

### Key Features

✅ **File Support:** Excel (.xlsx) & CSV files  
✅ **Auto-column Detection:** Extracts columns from uploaded files  
✅ **Smart Filtering:** Multi-select distinct values from filter column  
✅ **Automatic Calculation:** Total → Refunds → Net → Tax → Final  
✅ **Tax Methods:** 
   - Fixed Percentage (e.g., 2.5%)
   - Fixed Amount (e.g., 50,000 EGP)
   - Column-based (sum from file column)  
✅ **Settings Storage:** Per-payment-method persistent configuration  
✅ **Auto-populate:** Pre-fill form from saved settings  
✅ **Validation:** Required fields and type checking  
✅ **Security:** Admin-only settings, user-based deposit access  

### Example Workflow

**Setup (Admin):**
1. Go to `/deposits/settings`
2. Select "Bank Transfer" payment method
3. Configure:
   - Filter Column: "Account Type"
   - Amount Column: "Total"
   - Refund Column: "Refund"
   - Tax: 2.5% fixed percentage
   - Default Filters: Current Account, Savings Account
4. Click "Save Settings"

**Usage (User):**
1. Go to `/deposits/upload`
2. Select "Bank Transfer", date range, upload file
3. **Auto-filled** from settings! ⚡
4. Review and click "Calculate & Process"
5. Click "Save Deposit"

**Example Calculation:**
```
File: deposits.xlsx (500 rows)
Filter applied: 320 rows match

Total Amount:    325,000.00 EGP
- Refunds:       (8,000.00) EGP
= Net Amount:    317,000.00 EGP
+ Tax (2.5%):    7,925.00 EGP
= Final Amount:  324,925.00 EGP
```

### Database Schema

**Tables:**
- `payment_method_deposit_settings` - Per-method configurations
- `deposits` - Submitted deposits with calculations

**RLS Policies:**
- Settings: Admins only (read for all)
- Deposits: Admins can manage all, users own their deposits

### Documentation

See [DEPOSITS_IMPLEMENTATION_COMPLETE.md](./DEPOSITS_IMPLEMENTATION_COMPLETE.md) for:
- Complete API documentation
- Data types and interfaces
- Utility functions reference
- Detailed examples
- Implementation checklist

---

## 🛠 Technology Stack

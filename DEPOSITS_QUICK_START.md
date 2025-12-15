# 🚀 Deposits System - Quick Start Guide

## For Admins: Initial Setup (5 minutes)

### Step 1: Access Settings Page
```
Navigate to: http://localhost:3001/deposits/settings
(Only visible if you're logged in as admin)
```

### Step 2: Configure a Payment Method
```
1. Click on "Bank Transfer" (or any payment method)
2. Fill in Column Mapping:
   - Filter Column: "Account Type" (leave empty if no filter needed)
   - Amount Column: "Total" (required)
   - Refund Column: "Refund" (optional)

3. Add Default Filter Values (if filter column selected):
   - Type: "Current Account" + Press Enter
   - Type: "Savings Account" + Press Enter

4. Configure Tax:
   ☑ Enable Tax Amount
   - Method: Fixed Percentage (%)
   - Value: 2.5

5. Click "Save Settings"
```

### Step 3: Repeat for Other Payment Methods
```
Configure as many payment methods as needed
Each saves independently
```

---

## For Users: Upload Deposits (5-10 minutes)

### Step 1: Go to Upload Page
```
Navigate to: http://localhost:3001/deposits/upload
```

### Step 2: Select and Upload
```
1. Payment Method: [Select "Bank Transfer" ▼]
2. Start Date: [2025-12-01]
3. End Date: [2025-12-31]
4. File: [Choose your Excel or CSV file]
5. Click "Done Upload"

⚡ Settings automatically loaded from configuration!
```

### Step 3: Configure Columns (if needed)
```
Form is pre-filled from settings!

If you want to change anything:
1. Filter Column: [Pre-selected column] or change it
2. Amount Column: [Pre-selected] - usually correct
3. Refund Column: [Pre-selected] or leave blank

Click "Calculate & Process"
```

### Step 4: Review Results
```
Total Amount:    325,000.00 EGP ✓
Total Refunds:   (8,000.00) EGP ✓
Net Amount:      317,000.00 EGP ✓
Tax (2.5%):      7,925.00 EGP ✓
Final Amount:    324,925.00 EGP ✓

Click "Save Deposit"
```

---

## 📁 Sample File Format

Your uploaded Excel/CSV should have columns like:

```
| Account Type    | Transaction Date | Amount | Refund | Description      |
|-----------------|------------------|--------|--------|------------------|
| Current Account | 2025-12-01       | 100000 | 5000   | Transfer 1       |
| Savings Account | 2025-12-02       | 200000 | 10000  | Deposit          |
| Current Account | 2025-12-05       | 150000 | 0      | Interest Payment |
| Savings Account | 2025-12-10       | 75000  | 3000   | Refund           |
```

**Note:** Column names must match exactly what you configured in settings!

---

## ✅ Common Scenarios

### Scenario 1: Simple Deposit (No Filter)
```
Admin Config:
- Filter: (leave empty)
- Amount: Total
- Refund: Refund
- Tax: 2.5%

User Upload:
- Upload file → Calculate → Save
- Done! ✓
```

### Scenario 2: Filtered Deposit
```
Admin Config:
- Filter: Account Type
- Filter Values: Current Account, Savings Account
- Amount: Total
- Refund: Refund
- Tax: 2.5%

User Upload:
- Upload file
- Only rows with "Current Account" or "Savings Account" counted
- Calculate → Save
- Done! ✓
```

### Scenario 3: Tax from File Column
```
Admin Config:
- Amount: Total
- Refund: Refund
- Tax Method: Column-based
- Tax Column: Tax

User Upload:
- Upload file (must have "Tax" column)
- Amounts summed, Refunds subtracted, Tax column summed
- Calculate → Save
- Done! ✓
```

---

## 🔍 Troubleshooting

### File won't upload
- ✅ Ensure file is Excel (.xlsx) or CSV
- ✅ File is not corrupted
- ✅ File is under 10MB
- ✅ First row has headers

### Column selector is empty
- ✅ File must have headers in first row
- ✅ Ensure header names match exactly what you're filtering by
- ✅ Try a different file format (Excel or CSV)

### No values in filter selector
- ✅ Check if filter column exists in file
- ✅ All values must be non-empty in that column

### Calculation shows 0 amounts
- ✅ Check if Amount Column name matches file header
- ✅ Amount column must contain numbers, not text
- ✅ Check that filter is correctly selecting rows

### Settings not saving
- ✅ Check if you're logged in as admin
- ✅ Amount Column is required
- ✅ If tax enabled, must select a tax method

---

## 📊 Data Flow Diagram

```
ADMIN SETUP
    ↓
Settings Page (/deposits/settings)
    ├─ Select Payment Method
    ├─ Configure Columns
    ├─ Add Filter Values
    ├─ Set Tax Method
    └─ Save Settings

        ↓
        
USER WORKFLOW
    ↓
Upload Page (/deposits/upload)
    ├─ Select Payment Method
    ├─ Upload File
    ├─ Settings Auto-Load ⚡
    ├─ Configure (Optional)
    ├─ Calculate
    └─ Review & Save

        ↓
        
DATABASE
    ├─ payment_method_deposit_settings
    └─ deposits
```

---

## 🎯 Key Points

1. **Admin First**: Always configure settings before users upload
2. **Auto-load**: Settings automatically apply to user uploads ⚡
3. **Flexible**: Users can change settings during upload if needed
4. **Save Settings**: Users can save new settings from upload page
5. **Tax Options**: Choose the tax method that fits your process
6. **Validation**: Required fields are enforced with error messages

---

## 💡 Best Practices

✅ Create settings for each payment method once  
✅ Test with sample file before users use it  
✅ Keep column names consistent in uploaded files  
✅ Document which columns to use in your file template  
✅ Monitor the audit trail for deposits  

---

## 📞 Support

If something isn't working:
1. Check the browser console for error messages (F12)
2. Verify file format (Excel or CSV with headers)
3. Ensure column names in settings match file headers
4. Contact admin for permission/settings issues

---

## 🔐 Security Notes

- Only admins can configure settings
- Each user's deposits are only visible to them (or admins)
- All operations logged with user ID and timestamp
- Settings are immutable once saved (delete and recreate to modify)

---

**Ready to go! 🚀**


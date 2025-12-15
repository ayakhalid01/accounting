# ÌæØ Deposits System - Complete Setup Guide

## Features Implemented ‚úÖ

### 1. **File Upload System** Ì≥§
- Multiple file uploads (CSV, Excel, TXT, DOC, PDF, Images)
- File preview in expandable rows
- Download any file
- Delete files from upload form
- Image preview with thumbnail
- File size and type display

### 2. **Edit & Delete** ‚úèÔ∏èÌ∑ëÔ∏è
- Users can EDIT pending deposits
- Users can DELETE pending deposits
- Only available for own deposits
- Not available after approval/rejection

### 3. **Advanced Filters** Ì¥ç
- **Date Range Filter** with overlap detection:
  - Example: Filter 1/12-5/12 shows:
    - ‚úÖ 28/11-3/12 (overlaps)
    - ‚úÖ 5/12-30/12 (overlaps)
    - ‚ùå 12/12-30/12 (no overlap)
- **Status Filter**: All / Pending / Approved / Rejected
- **Payment Method Filter**: Filter by specific method
- Clear Filters button

### 4. **Expandable Rows** ÔøΩÔøΩ
- Click chevron to expand row
- Shows all attached files
- Shows notes
- Preview images inline
- Download/View buttons per file

### 5. **Admin Controls** Ìª°Ô∏è
- View all deposits from all users
- Approve with one click
- Reject with reason
- Approve/Reject only for pending

### 6. **User Controls** Ì±§
- Submit deposits with files
- Edit pending deposits
- Delete pending deposits
- View own deposits only

## Database Migrations

### Migration 012: Deposits Table
File: `supabase/migrations/012_add_deposits_approval.sql`
```sql
- Creates deposits table
- RLS policies for users/admins
- Indexes for performance
```

### Migration 013: Storage Bucket
File: `supabase/migrations/013_deposits_storage.sql`
```sql
- Creates 'deposits' storage bucket
- RLS policies for file access
- User can upload to own folder
- Admin can view all files
```

## Setup Steps

### 1. Execute Migration 012
```bash
# Open Supabase Dashboard ‚Üí SQL Editor
# Copy content from: supabase/migrations/012_add_deposits_approval.sql
# Execute
```

### 2. Execute Migration 013
```bash
# Open Supabase Dashboard ‚Üí SQL Editor
# Copy content from: supabase/migrations/013_deposits_storage.sql
# Execute
```

### 3. Create Storage Bucket (Alternative to Migration 013)
If migration fails, create manually:
```
1. Supabase Dashboard ‚Üí Storage
2. Click "New bucket"
3. Name: deposits
4. Public: Yes
5. Create
```

### 4. Configure Storage Policies
```
1. Go to Storage ‚Üí deposits bucket
2. Click "Policies"
3. Add policies from migration 013
```

## Usage Guide

### For Users:

#### Submit New Deposit:
1. Click "New Deposit" button
2. Fill form:
   - Date Range (required)
   - Total Amount (required)
   - Tax Amount (optional)
   - Payment Method (required)
   - Notes (optional)
   - Upload Files (optional, multiple)
3. Click "Submit for Approval"
4. Status: Pending ‚è≥

#### Edit Deposit:
1. Find your pending deposit
2. Click "Edit" button
3. Modify fields
4. Add/remove files
5. Click "Update Deposit"

#### Delete Deposit:
1. Find your pending deposit
2. Click "Delete" button
3. Confirm deletion

#### View Files:
1. Click chevron (‚ñº) on any row
2. See all files with preview
3. Click "View" for images
4. Click "Download" for any file

### For Admins:

#### Review Deposits:
1. Navigate to Deposits page
2. See all deposits from all users
3. Use filters to find specific deposits

#### Approve:
1. Find pending deposit
2. Click "Approve" button
3. Status changes to Approved ‚úÖ

#### Reject:
1. Find pending deposit
2. Click "Reject" button
3. Enter rejection reason
4. Status changes to Rejected ‚ùå

#### Use Filters:
```
Date Range: 1/12/2025 - 5/12/2025
Status: Pending
Payment Method: Paymob
```

## API Endpoints

### Storage
- Upload: `/storage/v1/object/deposits/{userId}/{filename}`
- Download: `/storage/v1/object/public/deposits/{userId}/{filename}`

### Database
- GET deposits: `SELECT * FROM deposits`
- INSERT deposit: `INSERT INTO deposits (...)`
- UPDATE deposit: `UPDATE deposits SET ... WHERE id = ?`
- DELETE deposit: `DELETE FROM deposits WHERE id = ?`

## File Types Supported

| Type | Extensions | Preview |
|------|-----------|---------|
| Images | .jpg, .jpeg, .png, .gif | ‚úÖ Inline |
| Excel | .xlsx, .xls | ‚ùå Download only |
| CSV | .csv | ‚ùå Download only |
| Documents | .doc, .docx, .pdf | ‚ùå Download only |
| Text | .txt | ‚ùå Download only |

## Security

### RLS Policies:
- ‚úÖ Users see only their deposits
- ‚úÖ Users edit only pending deposits
- ‚úÖ Admins see all deposits
- ‚úÖ Admins update all deposits
- ‚úÖ File access controlled by folder
- ‚úÖ Admin can access all files

## Testing Checklist

- [ ] User can submit deposit
- [ ] User can upload multiple files
- [ ] User can edit pending deposit
- [ ] User can delete pending deposit
- [ ] User sees only own deposits
- [ ] Admin sees all deposits
- [ ] Admin can approve/reject
- [ ] Date filter works with overlap
- [ ] Status filter works
- [ ] Payment method filter works
- [ ] Expand row shows files
- [ ] Can download files
- [ ] Image preview works
- [ ] Edit preserves existing files
- [ ] Can add new files when editing
- [ ] Can remove files in form

## Troubleshooting

### Files not uploading?
- Check storage bucket exists
- Verify RLS policies
- Check bucket is public
- Ensure user authenticated

### Can't see deposits?
- Check RLS policies enabled
- Verify user_profiles role
- Check user_id matches

### Filters not working?
- Clear browser cache
- Check date format (YYYY-MM-DD)
- Verify payment_method_id exists

## Next Features (Optional)

- [ ] Bulk approve/reject
- [ ] Export deposits to Excel
- [ ] Email notifications
- [ ] File size validation
- [ ] Drag & drop upload
- [ ] Progress bar for uploads
- [ ] Search by notes
- [ ] Sort by date/amount

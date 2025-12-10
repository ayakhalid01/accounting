'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Download, History, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import * as XLSX from 'xlsx';

interface PaymentMethod {
  id: string;
  name_ar: string;
  name_en: string;
  code: string;
  type: string;
  tax_rate: number;
}

interface ParsedRow {
  reference: string;
  payment_gateway: string;
  invoice_date: string;
  sale_order_date: string;
  amount: number;
  status: string;
}

interface FilePreview {
  name: string;
  size: number;
  totalRows: number;
  data: ParsedRow[];
}

interface UploadHistory {
  id: string;
  file_name: string;
  created_at: string;
  import_type: 'invoices' | 'credits';
  total_rows: number;
}

export default function UploadsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  
  // Invoices Upload
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<FilePreview | null>(null);
  const [uploadingInvoices, setUploadingInvoices] = useState(false);
  const [deleteInvoicesAfterUpload, setDeleteInvoicesAfterUpload] = useState(false);
  const [invoiceBatchProgress, setInvoiceBatchProgress] = useState<{ current: number; total: number } | null>(null);
  
  // Credits Upload
  const [creditFile, setCreditFile] = useState<File | null>(null);
  const [creditPreview, setCreditPreview] = useState<FilePreview | null>(null);
  const [uploadingCredits, setUploadingCredits] = useState(false);
  const [deleteCreditsAfterUpload, setDeleteCreditsAfterUpload] = useState(false);
  const [creditBatchProgress, setCreditBatchProgress] = useState<{ current: number; total: number } | null>(null);
  
  // History
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const init = async () => {
      console.log('📤 [UPLOADS] Checking authentication...');
      const { session } = await auth.getSession();
      
      if (!session) {
        console.log('❌ [UPLOADS] No session, redirecting to login');
        router.push('/login');
        return;
      }
      
      await loadPaymentMethods();
      await loadHistory();
      setLoading(false);
    };

    init();
  }, [router]);

  const loadPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('name_en');

      if (error) throw error;
      setPaymentMethods(data || []);
    } catch (err: any) {
      console.error('❌ Error loading payment methods:', err);
      setError('Failed to load payment methods');
    }
  };

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('upload_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5); // Only show last 5 uploads

      if (error) {
        console.error('❌ Error loading history:', error);
        setHistory([]);
      } else {
        setHistory(data || []);
        console.log('✅ Loaded upload history:', data?.length);
      }
    } catch (err: any) {
      console.error('❌ Error loading history:', err);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDownload = async (historyItem: UploadHistory) => {
    try {
      console.log('⬇️ Downloading:', historyItem.file_name);
      
      const table = historyItem.import_type === 'invoices' ? 'invoices' : 'credit_notes';
      const numberField = historyItem.import_type === 'invoices' ? 'invoice_number' : 'credit_note_number';
      
      // Get data from database
      const { data, error } = await supabase
        .from(table)
        .select(`
          *,
          payment_methods(name_en)
        `)
        .order('sale_order_date', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert('No data found to download');
        return;
      }

      // Create CSV
      const headers = ['Reference', 'Payment Gateway', 'Sale Order Date', 'Amount Total', 'Status'];
      const rows = data.map((item: any) => [
        item[numberField] || '',
        item.payment_methods?.name_en || '',
        new Date(item.sale_order_date).toLocaleString(),
        item.amount_total,
        item.state
      ]);

      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      
      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = historyItem.file_name.replace(/\.[^/.]+$/, '') + '_exported.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      console.log('✅ Download complete');
    } catch (err: any) {
      console.error('❌ Download failed:', err);
      alert('Download failed: ' + err.message);
    }
  };

  const parseAmount = (amountStr: string): number => {
    const cleaned = amountStr.toString().replace(/[^\d.,-]/g, '').replace(',', '');
    return parseFloat(cleaned) || 0;
  };

  // Cache for parsed dates (speeds up repeated date parsing)
  const dateCache = new Map<string, string>();
  
  // Excel epoch constants (pre-calculated)
  const EXCEL_EPOCH_MS = new Date(1900, 0, 1).getTime();
  const MS_PER_DAY = 86400000; // 24 * 60 * 60 * 1000
  
  const parseDate = (dateStr: string): string => {
    if (!dateStr) return new Date().toISOString();
    
    const dateKey = dateStr.toString();
    
    // Check cache first (huge speedup for duplicate dates!)
    if (dateCache.has(dateKey)) {
      return dateCache.get(dateKey)!;
    }
    
    try {
      const dateValue = dateKey.trim();
      
      // Check if it's an Excel serial number (numeric value like 45987.98545138889)
      const numericDate = parseFloat(dateValue);
      if (!isNaN(numericDate) && numericDate > 40000 && numericDate < 60000) {
        // Excel date serial number (days since 1900-01-01)
        const days = Math.floor(numericDate) - 2; // -2 to account for Excel's leap year bug
        const milliseconds = (numericDate - Math.floor(numericDate)) * MS_PER_DAY;
        const timestamp = EXCEL_EPOCH_MS + (days * MS_PER_DAY) + milliseconds;
        const result = new Date(timestamp).toISOString();
        dateCache.set(dateKey, result);
        return result;
      }
      
      // Handle text date format "2025-09-30 14:28:28" or "2025-09-30"
      const cleanDate = dateValue.includes(' ') ? dateValue.split(' ')[0] : dateValue;
      const date = new Date(cleanDate);
      
      if (isNaN(date.getTime())) {
        const now = new Date().toISOString();
        dateCache.set(dateKey, now);
        return now;
      }
      
      const result = date.toISOString();
      dateCache.set(dateKey, result);
      return result;
    } catch (err) {
      const now = new Date().toISOString();
      dateCache.set(dateKey, now);
      return now;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'invoice' | 'credit') => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    console.log('📁 File selected:', selectedFile.name);
    setError('');

    try {
      // Quick preview without full parsing (just read row count)
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        // Lightweight preview - only parse first 10 rows for display
        const parsedRows: ParsedRow[] = jsonData.slice(0, 10).map((row: any) => {
          const amount = parseAmount(row['Total in Currency Signed'] || row['Amount'] || row['Total'] || '0');
          
          return {
            reference: row['Reference'] || row['Invoice Number'] || '',
            payment_gateway: row['Payment Gateway'] || row['Payment Method'] || '',
            invoice_date: parseDate(row['Invoice/Bill Date'] || row['Invoice Date']),
            sale_order_date: parseDate(row['Sale Order Date'] || row['Order Date']),
            amount: Math.abs(amount),
            status: row['Status'] || 'posted',
          };
        });

        const preview: FilePreview = {
          name: selectedFile.name,
          size: selectedFile.size,
          totalRows: jsonData.length,
          data: parsedRows,
        };

        if (type === 'invoice') {
          setInvoiceFile(selectedFile);
          setInvoicePreview(preview);
        } else {
          setCreditFile(selectedFile);
          setCreditPreview(preview);
        }

        console.log('✅ File parsed:', jsonData.length, 'rows');
      };
      reader.readAsBinaryString(selectedFile);
    } catch (err: any) {
      console.error('❌ Error reading file:', err);
      setError('Error reading file: ' + err.message);
    }
  };

  const handleImport = async (type: 'invoice' | 'credit') => {
    const file = type === 'invoice' ? invoiceFile : creditFile;
    if (!file) return;

    const shouldDelete = type === 'invoice' ? deleteInvoicesAfterUpload : deleteCreditsAfterUpload;

    console.log('📤 Starting import:', type);
    if (type === 'invoice') {
      setUploadingInvoices(true);
    } else {
      setUploadingCredits(true);
    }
    setError('');
    setSuccess('');

    try {
      const { session } = await auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      // Delete existing records if checkbox is checked
      if (shouldDelete) {
        console.log(`🗑️ Deleting existing ${type}s...`);
        
        if (type === 'invoice') {
          // For invoices, delete credits first (foreign key constraint)
          console.log('🗑️ First deleting all related credits...');
          const { count: creditsCount } = await supabase
            .from('credit_notes')
            .select('*', { count: 'exact', head: true });
          
          console.log(`📊 Found ${creditsCount} credits to delete`);
          
          const { error: creditsError } = await supabase
            .from('credit_notes')
            .delete({ count: 'exact' })
            .neq('id', '00000000-0000-0000-0000-000000000000');
          
          if (creditsError) {
            console.error('❌ Error deleting credits:', creditsError);
            setError(`Failed to delete credits: ${creditsError.message}`);
            return;
          } else {
            console.log(`✅ Deleted ${creditsCount} credits`);
          }
        }
        
        const table = type === 'invoice' ? 'invoices' : 'credit_notes';
        
        // Count before delete
        const { count: beforeCount } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        console.log(`📊 Found ${beforeCount} existing ${type}s to delete`);
        
        // Fast delete using SQL (much faster than REST API batches)
        const startDelete = performance.now();
        
        // Use raw SQL for fast deletion
        const { error: deleteError } = await supabase.rpc('delete_all_records', {
          table_name: table
        });
        
        if (deleteError) {
          // Fallback to batch deletion if RPC not available
          console.warn('⚠️ RPC not available, using batch deletion...');
          
          const DELETE_BATCH_SIZE = 5000;
          let totalDeleted = 0;
          
          while (totalDeleted < (beforeCount || 0)) {
            const { data: batch } = await supabase
              .from(table)
              .select('id')
              .limit(DELETE_BATCH_SIZE);
            
            if (!batch || batch.length === 0) break;
            
            // Delete in chunks of 500
            const chunkSize = 500;
            for (let i = 0; i < batch.length; i += chunkSize) {
              const chunk = batch.slice(i, i + chunkSize);
              const ids = chunk.map(r => r.id);
              
              await supabase.from(table).delete().in('id', ids);
              totalDeleted += chunk.length;
              console.log(`🗑️ Deleted ${totalDeleted}/${beforeCount} ${type}s...`);
            }
          }
        }
        
        const deleteTime = ((performance.now() - startDelete) / 1000).toFixed(2);
        console.log(`✅ Deleted ${beforeCount} existing ${type}s in ${deleteTime}s`);
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const startTime = performance.now();
          
          // Clear date cache for fresh parsing
          dateCache.clear();
          
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

          console.log(`⚡ Parsing ${jsonData.length} rows...`);
          let successCount = 0;
          const errors: string[] = [];

          // Group by Reference + Payment Gateway (composite key)
          const groupedData = new Map<string, any>();
          let skippedEmptyRefs = 0;
          
          for (const row of jsonData) {
            const reference = row['Reference'] || '';
            
            // Skip rows with empty reference
            if (!reference || reference.trim() === '') {
              skippedEmptyRefs++;
              continue;
            }
            
            const amount = parseAmount(row['Total in Currency Signed'] || row['Amount'] || row['Total'] || '0');
            const saleOrderDate = parseDate(row['Sale Order Date'] || row['Order Date'] || '');
            const paymentGateway = row['Payment Gateway'] || row['Payment Method'] || '';
            
            // Create composite key: "Reference|PaymentGateway"
            const compositeKey = `${reference}|${paymentGateway}`;
            
            if (groupedData.has(compositeKey)) {
              // Add to existing and take the latest date
              const existing = groupedData.get(compositeKey);
              existing.amount += Math.abs(amount);
              
              // Compare ISO strings directly (faster than creating Date objects)
              if (saleOrderDate > existing.saleOrderDate) {
                existing.saleOrderDate = saleOrderDate;
              }
            } else {
              // Create new entry
              groupedData.set(compositeKey, {
                reference,
                amount: Math.abs(amount),
                saleOrderDate,
                paymentGateway,
                status: row['Status'] || 'posted'
              });
            }
          }

          console.log(`📊 Grouped ${jsonData.length} rows into ${groupedData.size} unique (Reference + Gateway) combinations`);
          if (skippedEmptyRefs > 0) {
            console.log(`⏭️ Skipped ${skippedEmptyRefs} rows with empty Reference`);
          }

          // Prepare constants
          const table = type === 'invoice' ? 'invoices' : 'credit_notes';
          const numberField = type === 'invoice' ? 'invoice_number' : 'credit_note_number';
          const dateField = type === 'invoice' ? 'invoice_date' : 'credit_date';
          const recordsToInsert: any[] = [];

          // Phase 1A: For credits, prepare data for database matching
          let matchedCount = 0;
          let skippedCount = 0;
          let creditsToMatch: any[] = [];

          // Phase 1B: Prepare all records
          for (const [compositeKey, groupedRow] of groupedData) {
            try {
              let paymentMethod = paymentMethods.find(pm => 
                pm.name_en.toLowerCase().includes(groupedRow.paymentGateway.toLowerCase()) ||
                pm.code.toLowerCase().includes(groupedRow.paymentGateway.toLowerCase())
              );

              if (!paymentMethod && groupedRow.paymentGateway) {
                const { data: newMethod, error: methodError } = await supabase
                  .from('payment_methods')
                  .insert({
                    name_en: groupedRow.paymentGateway,
                    name_ar: groupedRow.paymentGateway,
                    code: groupedRow.paymentGateway.toUpperCase().replace(/\s+/g, '_'),
                    type: 'manual',
                    is_active: true
                  })
                  .select()
                  .single();

                if (!methodError && newMethod) {
                  paymentMethod = newMethod;
                  paymentMethods.push(newMethod);
                }
              }

              const recordData: any = {
                [numberField]: groupedRow.reference, // Reference is already validated (not empty)
                partner_name: 'Imported Customer',
                payment_method_id: paymentMethod?.id || null,
                [dateField]: groupedRow.saleOrderDate,
                sale_order_date: groupedRow.saleOrderDate,
                amount_total: groupedRow.amount,
                currency: 'EGP',
                state: 'posted',
                imported_by: session.user.id,
              };

              if (type === 'invoice') {
                recordData.invoice_type = 'invoice';
              }

              if (type === 'credit') {
                // Store credit info for batch matching via database function
                creditsToMatch.push({
                  tempId: recordsToInsert.length, // Temporary ID to track position
                  reference: groupedRow.reference,
                  payment_method_id: paymentMethod?.id || null,
                  gateway_name: groupedRow.paymentGateway,
                  recordData: recordData
                });
              }

              recordsToInsert.push(recordData);
            } catch (rowErr: any) {
              errors.push(`${groupedRow.reference}: ${rowErr.message}`);
            }
          }
          
          // Phase 1C: For credits, use database function to match in batches
          if (type === 'credit' && creditsToMatch.length > 0) {
            console.log(`🔍 Matching ${creditsToMatch.length} credits using database function...`);
            console.log(`📊 Audit: Preparing ${creditsToMatch.length} credits for matching`);
            const matchStartTime = performance.now();
            
            // Log sample of credits being matched
            const sampleCredits = creditsToMatch.slice(0, 5);
            console.log('📋 Sample credits to match:', sampleCredits.map(c => ({
              ref: c.reference,
              gateway: c.gateway_name,
              payment_method_id: c.payment_method_id ? c.payment_method_id.substring(0, 8) + '...' : 'null'
            })));
            
            // Split into batches to avoid statement timeout (5000 credits per batch)
            const MATCH_BATCH_SIZE = 5000;
            const totalMatchBatches = Math.ceil(creditsToMatch.length / MATCH_BATCH_SIZE);
            const allMatches: any[] = [];
            let matchError: any = null;
            
            console.log(`🚀 Splitting into ${totalMatchBatches} batches (${MATCH_BATCH_SIZE} credits per batch)...`);
            
            for (let batchIdx = 0; batchIdx < totalMatchBatches; batchIdx++) {
              const batchStart = batchIdx * MATCH_BATCH_SIZE;
              const batchEnd = Math.min(batchStart + MATCH_BATCH_SIZE, creditsToMatch.length);
              const batchCredits = creditsToMatch.slice(batchStart, batchEnd);
              
              console.log(`📦 Matching batch ${batchIdx + 1}/${totalMatchBatches} (${batchCredits.length} credits)...`);
              
              // Prepare credits array with UUIDs for the function
              const creditsPayload = batchCredits.map((c, idx) => ({
                id: `00000000-0000-0000-0000-${String(batchStart + idx).padStart(12, '0')}`, // Global index
                reference: c.reference,
                payment_method_id: c.payment_method_id,
                gateway_name: c.gateway_name
              }));
              
              // Call database function for this batch
              // WORKAROUND: Use range(0, 99999) instead of limit() to bypass PostgREST default limit
              console.log(`🔧 Calling RPC for batch ${batchIdx + 1} with ${creditsPayload.length} credits...`);
              
              const { data: batchMatches, error: batchError } = await supabase
                .rpc('match_credits_to_invoices', { p_credits: creditsPayload })
                .range(0, 99999); // Use range instead of limit to get all results
              
              console.log(`📊 Batch ${batchIdx + 1} response: ${batchMatches?.length || 0} matches returned`);
              
              if (batchError) {
                console.error(`❌ Error in batch ${batchIdx + 1}:`, batchError.message);
                matchError = batchError;
                break; // Stop on first error
              }
              
              if (batchMatches && batchMatches.length > 0) {
                allMatches.push(...batchMatches);
                console.log(`✅ Batch ${batchIdx + 1}: Found ${batchMatches.length} matches out of ${creditsPayload.length} credits`);
                
                // Check if we hit a limit
                if (batchMatches.length === 1000) {
                  console.warn(`⚠️ WARNING: Batch ${batchIdx + 1} returned EXACTLY 1000 - PostgREST limit still active!`);
                  console.warn(`💡 This means only 1000/${creditsPayload.length} potential matches were checked`);
                }
              } else {
                console.log(`⚠️ Batch ${batchIdx + 1}: No matches found`);
              }
            }
            
            const matchTime = ((performance.now() - matchStartTime) / 1000).toFixed(2);
            console.log(`⏱️ Database function completed in ${matchTime}s`);
            
            const matches = allMatches;
            
            if (matchError) {
              console.error('❌ Error matching credits:', matchError);
              console.error('📋 Error details:', {
                message: matchError.message,
                code: matchError.code,
                details: matchError.details,
                hint: matchError.hint
              });
              errors.push(`Credit matching error: ${matchError.message}`);
            } else if (matches && matches.length > 0) {
              console.log(`✅ Database returned ${matches.length} matches`);
              console.log(`⚡ Matched ${matches.length}/${creditsToMatch.length} credits in ${matchTime}s using database function`);
              
              // Count match types
              const exactMatches = matches.filter((m: any) => m.match_type === 'exact').length;
              const fallbackMatches = matches.filter((m: any) => m.match_type === 'gateway_fallback').length;
              console.log(`📊 Match breakdown: ${exactMatches} exact, ${fallbackMatches} gateway fallback`);
              
              // Log first 10 matches for audit
              const sampleMatches = matches.slice(0, 10);
              console.log('📋 Sample matches:', sampleMatches.map((m: any) => ({
                type: m.match_type,
                credit_idx: parseInt(m.credit_id.split('-').pop()),
                invoice_id: m.invoice_id.substring(0, 8) + '...',
                invoice_number: m.invoice_number
              })));
              
              // Apply matches to recordsToInsert
              let appliedMatches = 0;
              matches.forEach((match: any) => {
                // Extract temp ID from the UUID we created
                const tempId = parseInt(match.credit_id.split('-').pop());
                const credit = creditsToMatch[tempId];
                
                if (credit) {
                  const recordIdx = credit.tempId;
                  recordsToInsert[recordIdx].original_invoice_id = match.invoice_id;
                  matchedCount++;
                  appliedMatches++;
                  
                  // Log first 5 matches in detail
                  if (appliedMatches <= 5) {
                    console.log(`✅ ${match.match_type}: ${credit.reference} (${credit.gateway_name}) → ${match.invoice_number}`);
                  }
                } else {
                  console.warn(`⚠️ Could not find credit for temp ID ${tempId}`);
                }
              });
              
              skippedCount = creditsToMatch.length - matchedCount;
              console.log(`📊 Final Results: ${matchedCount} matched, ${skippedCount} skipped (no invoice found)`);
              console.log(`📈 Match rate: ${((matchedCount / creditsToMatch.length) * 100).toFixed(2)}%`);
              
              // Log sample of unmatched credits for debugging
              if (skippedCount > 0) {
                const unmatchedCredits = creditsToMatch.filter((c, idx) => {
                  const tempUuid = `00000000-0000-0000-0000-${String(idx).padStart(12, '0')}`;
                  return !matches.find((m: any) => m.credit_id === tempUuid);
                }).slice(0, 5);
                
                console.log('⚠️ Sample unmatched credits:', unmatchedCredits.map(c => ({
                  ref: c.reference,
                  gateway: c.gateway_name,
                  payment_method_id: c.payment_method_id ? c.payment_method_id.substring(0, 8) + '...' : 'null'
                })));
              }
            } else {
              console.warn('⚠️ No matches found from database function');
              console.log('📋 Database returned:', matches);
              console.log('📊 Total credits processed:', creditsToMatch.length);
              skippedCount = creditsToMatch.length;
            }
            
            // Remove credits without matches
            if (skippedCount > 0) {
              const originalLength = recordsToInsert.length;
              console.log(`🗑️ Removing ${skippedCount} unmatched credits from insert batch...`);
              recordsToInsert.splice(0, recordsToInsert.length, 
                ...recordsToInsert.filter(r => r.original_invoice_id)
              );
              console.log(`✅ Reduced insert batch from ${originalLength} to ${recordsToInsert.length} records`);
              console.log(`⏭️ Removed ${skippedCount} credits without matching invoices`);
            }
          }

          // Phase 2: Parallel batch insert (faster!)
          const BATCH_SIZE = 2000;
          const PARALLEL_BATCHES = 5; // Insert 5 batches simultaneously
          const totalBatches = Math.ceil(recordsToInsert.length / BATCH_SIZE);
          console.log(`⚡ Batch inserting ${recordsToInsert.length} records (${BATCH_SIZE} per batch, ${PARALLEL_BATCHES} parallel)...`);
          
          const insertStartTime = performance.now();
          
          // Process batches in parallel groups
          for (let i = 0; i < totalBatches; i += PARALLEL_BATCHES) {
            const promises = [];
            const batchInfos: { batchNum: number; size: number }[] = [];
            
            // Prepare parallel batch requests
            for (let j = 0; j < PARALLEL_BATCHES && (i + j) < totalBatches; j++) {
              const batchIndex = i + j;
              const start = batchIndex * BATCH_SIZE;
              const batch = recordsToInsert.slice(start, start + BATCH_SIZE);
              const batchNum = batchIndex + 1;
              
              batchInfos.push({ batchNum, size: batch.length });
              
              promises.push(
                supabase
                  .from(table)
                  .upsert(batch, { 
                    onConflict: numberField,
                    ignoreDuplicates: false 
                  })
              );
            }
            
            // Update progress
            const currentBatch = i + PARALLEL_BATCHES;
            if (type === 'invoice') {
              setInvoiceBatchProgress({ current: Math.min(currentBatch, totalBatches), total: totalBatches });
            } else {
              setCreditBatchProgress({ current: Math.min(currentBatch, totalBatches), total: totalBatches });
            }
            
            console.log(`📦 Processing batches ${i + 1}-${Math.min(i + PARALLEL_BATCHES, totalBatches)}/${totalBatches}...`);
            
            // Execute all batches in parallel
            const results = await Promise.all(promises);
            
            // Process results
            results.forEach((result, idx) => {
              const info = batchInfos[idx];
              if (result.error) {
                console.error(`❌ Batch ${info.batchNum} error:`, result.error);
                errors.push(`Batch ${info.batchNum}: ${result.error.message}`);
              } else {
                successCount += info.size;
              }
            });
            
            console.log(`✅ Completed ${successCount}/${recordsToInsert.length} records`);
          }
          
          const insertTime = ((performance.now() - insertStartTime) / 1000).toFixed(2);
          console.log(`⚡ Inserted ${successCount} records in ${insertTime}s`);
          
          // Clear progress after completion
          if (type === 'invoice') {
            setInvoiceBatchProgress(null);
          } else {
            setCreditBatchProgress(null);
          }

          // Save upload history and keep only last 5
          await supabase.from('upload_history').insert({
            file_name: file.name,
            import_type: type === 'invoice' ? 'invoices' : 'credits',
            total_rows: jsonData.length,
            success_count: successCount,
            error_count: errors.length,
            uploaded_by: session.user.id,
          });
          
          // Clean up old history - keep only last 5 per user
          const { data: allHistory } = await supabase
            .from('upload_history')
            .select('id')
            .eq('uploaded_by', session.user.id)
            .order('created_at', { ascending: false });
          
          if (allHistory && allHistory.length > 5) {
            const idsToDelete = allHistory.slice(5).map(h => h.id);
            await supabase
              .from('upload_history')
              .delete()
              .in('id', idsToDelete);
            console.log(`🗑️ Cleaned up ${idsToDelete.length} old history records`);
          }

          if (errors.length > 0) {
            setError(`Imported ${successCount} ${type}s with ${errors.length} errors. Check console.`);
            console.error('❌ Import errors:', errors);
          } else {
            const endTime = performance.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            const cacheHits = jsonData.length - dateCache.size;
            console.log(`⚡ Import completed in ${duration}s | Cache hits: ${cacheHits}/${jsonData.length}`);
            
            if (type === 'credit') {
              const totalGrouped = groupedData.size;
              const skippedCount = totalGrouped - successCount;
              setSuccess(`Successfully imported ${successCount} credit(s) in ${duration}s! ${skippedCount > 0 ? `(${skippedCount} skipped - no matching invoice)` : ''}`);
            } else {
              setSuccess(`Successfully imported ${successCount} ${type}s in ${duration}s!`);
            }
          }

          // Clear form
          if (type === 'invoice') {
            setInvoiceFile(null);
            setInvoicePreview(null);
            const fileInput = document.getElementById('invoice-file-input') as HTMLInputElement;
            if (fileInput) fileInput.value = '';
          } else {
            setCreditFile(null);
            setCreditPreview(null);
            const fileInput = document.getElementById('credit-file-input') as HTMLInputElement;
            if (fileInput) fileInput.value = '';
          }

          await loadHistory();

        } catch (err: any) {
          console.error('❌ Import failed:', err);
          setError('Import failed: ' + err.message);
        } finally {
          if (type === 'invoice') {
            setUploadingInvoices(false);
          } else {
            setUploadingCredits(false);
          }
        }
      };

      reader.readAsBinaryString(file);

    } catch (err: any) {
      console.error('❌ Upload failed:', err);
      setError('Upload failed: ' + err.message);
      if (type === 'invoice') {
        setUploadingInvoices(false);
      } else {
        setUploadingCredits(false);
      }
    }
  };

  if (loading) {
    return (
      <div>
        <Navigation />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary-500 border-r-transparent"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Import Data</h1>
          <p className="mt-2 text-gray-600">Upload invoices and credit notes from CSV/Excel files</p>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4 flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-green-900">Success!</p>
              <p className="text-sm text-green-700">{success}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Upload Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Invoices Upload */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-6 w-6 text-green-600" />
              <h2 className="text-xl font-bold text-gray-900">Import Invoices</h2>
            </div>

            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-400 transition-colors">
                <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                <label htmlFor="invoice-file-input" className="cursor-pointer">
                  <span className="text-sm font-medium text-green-600 hover:text-green-500">
                    Choose file
                  </span>
                  <input
                    id="invoice-file-input"
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileChange(e, 'invoice')}
                  />
                </label>
                <p className="text-xs text-gray-500 mt-1">Excel or CSV</p>
              </div>

              {invoicePreview && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-900">{invoicePreview.name}</p>
                  <p className="text-xs text-green-700 mt-1">
                    {invoicePreview.totalRows} rows • {(invoicePreview.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <input
                  id="delete-invoices-checkbox"
                  type="checkbox"
                  checked={deleteInvoicesAfterUpload}
                  onChange={(e) => setDeleteInvoicesAfterUpload(e.target.checked)}
                  className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                />
                <label htmlFor="delete-invoices-checkbox" className="text-sm text-gray-700 cursor-pointer">
                  Delete all existing invoices before upload
                </label>
              </div>

              <button
                onClick={() => handleImport('invoice')}
                disabled={!invoiceFile || uploadingInvoices}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploadingInvoices ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent"></div>
                    {invoiceBatchProgress ? (
                      `Batch ${invoiceBatchProgress.current}/${invoiceBatchProgress.total}`
                    ) : (
                      'Importing...'
                    )}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Invoices
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Credits Upload */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="h-6 w-6 text-red-600" />
              <h2 className="text-xl font-bold text-gray-900">Import Credits</h2>
            </div>

            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-red-400 transition-colors">
                <Upload className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                <label htmlFor="credit-file-input" className="cursor-pointer">
                  <span className="text-sm font-medium text-red-600 hover:text-red-500">
                    Choose file
                  </span>
                  <input
                    id="credit-file-input"
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileChange(e, 'credit')}
                  />
                </label>
                <p className="text-xs text-gray-500 mt-1">Excel or CSV</p>
              </div>

              {creditPreview && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-red-900">{creditPreview.name}</p>
                  <p className="text-xs text-red-700 mt-1">
                    {creditPreview.totalRows} rows • {(creditPreview.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <input
                  id="delete-credits-checkbox"
                  type="checkbox"
                  checked={deleteCreditsAfterUpload}
                  onChange={(e) => setDeleteCreditsAfterUpload(e.target.checked)}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <label htmlFor="delete-credits-checkbox" className="text-sm text-gray-700 cursor-pointer">
                  Delete all existing credits before upload
                </label>
              </div>

              <button
                onClick={() => handleImport('credit')}
                disabled={!creditFile || uploadingCredits}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploadingCredits ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent"></div>
                    {creditBatchProgress ? (
                      `Batch ${creditBatchProgress.current}/${creditBatchProgress.total}`
                    ) : (
                      'Importing...'
                    )}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Credits
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Import History */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-gray-600" />
                <h2 className="text-xl font-bold text-gray-900">Import History</h2>
              </div>
              <button
                onClick={loadHistory}
                disabled={loadingHistory}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <Calendar className="inline h-4 w-4 mr-1" />
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <FileSpreadsheet className="inline h-4 w-4 mr-1" />
                    File Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rows</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No import history yet</p>
                      <p className="text-sm mt-1">Upload your first file to see it here</p>
                    </td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{item.file_name}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          item.import_type === 'invoices' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {item.import_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{item.total_rows}</td>
                      <td className="px-6 py-4 text-sm">
                        <button 
                          onClick={() => handleDownload(item)}
                          className="text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1 hover:underline"
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 rounded-lg p-4 border border-blue-200">
          <p className="text-sm text-blue-900 font-medium mb-2">📋 File Format:</p>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li><strong>Reference:</strong> Invoice/Credit number</li>
            <li><strong>Payment Gateway:</strong> Payment method (Visa, Cash, etc.)</li>
            <li><strong>Invoice/Bill Date:</strong> Official document date</li>
            <li><strong>Sale Order Date:</strong> Actual order date (used for calculations)</li>
            <li><strong>Total in Currency Signed:</strong> Amount</li>
            <li><strong>Status:</strong> Document status</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

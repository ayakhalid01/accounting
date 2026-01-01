'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import AdminInlineDepositForm from '@/components/deposits/AdminInlineDepositForm';
import { Wallet, Plus, Calendar, DollarSign, CheckCircle, XCircle, Clock, Upload, Download, Eye, Trash2, Edit, Filter, ChevronDown, ChevronUp, FileText, Image as ImageIcon, File } from 'lucide-react';

interface Deposit {
  id: string;
  user_id: string;
  user_email?: string;
  start_date: string;
  end_date: string;
  total_amount: number;
  tax_amount: number;
  net_amount: number;
  gap_covered?: number;
  gap_uncovered?: number;
  remaining_amount?: number;
  payment_method_id: string;
  payment_method_name: string;
  method_group?: Array<{payment_method_id: string; name_en?: string}>;
  status: 'pending' | 'approved' | 'rejected';
  notes: string;
  rejection_reason?: string;
  created_at: string;
  reviewed_at?: string;
  proof_files?: string[]; // Array of file URLs
  payment_methods?: { name_en: string };
}

interface UploadedFile {
  name: string;
  url: string;
  type: string;
  size: number;
}

export default function DepositsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [filteredDeposits, setFilteredDeposits] = useState<Deposit[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
  // Allocation preview cache (deposit id -> preview)
  type MethodPreview = { payment_method_id: string; name?: string; gap_available: number; gap_covered: number; gap_uncovered: number; remaining: number };
  type AllocationPreview = { gap_covered: number; gap_uncovered: number; remaining: number; per_method?: MethodPreview[] };
  const [allocationPreview, setAllocationPreview] = useState<Record<string, AllocationPreview | null>>({});
  const [allocationPreviewTimes, setAllocationPreviewTimes] = useState<Record<string, string>>({});
  // Background allocation refresh state
  const [allocationRefreshingIds, setAllocationRefreshingIds] = useState<Set<string>>(new Set());
  const [allocationRefreshTimes, setAllocationRefreshTimes] = useState<Record<string, string>>({});
  const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const [previewLoadingIds, setPreviewLoadingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  
  // ============================================
  // Load Saved Filters from localStorage
  // ============================================
  const getSavedFilters = () => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('deposits_filters');
    return saved ? JSON.parse(saved) : null;
  };
  
  const savedFilters = getSavedFilters();
  
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Tax Configuration from Settings
  const [methodTaxSettings, setMethodTaxSettings] = useState<any>(null);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxMethod, setTaxMethod] = useState<string>('none');
  const [taxValue, setTaxValue] = useState<number | undefined>(undefined);
  const [taxColumnName, setTaxColumnName] = useState<string | undefined>(undefined);
  
  // Filters - Restored from localStorage
  const [filterStartDate, setFilterStartDate] = useState(savedFilters?.filterStartDate || '');
  const [filterEndDate, setFilterEndDate] = useState(savedFilters?.filterEndDate || '');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>(savedFilters?.filterStatus || 'all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState(savedFilters?.filterPaymentMethod || 'all');
  const [filterUploadedBy, setFilterUploadedBy] = useState(savedFilters?.filterUploadedBy || 'all');

  // Persistent Notes
  const [persistentNotes, setPersistentNotes] = useState('');
  
  // ============================================
  // Save Filters to localStorage
  // ============================================
  useEffect(() => {
    const filtersToSave = {
      filterStartDate,
      filterEndDate,
      filterStatus,
      filterPaymentMethod,
      filterUploadedBy
    };
    localStorage.setItem('deposits_filters', JSON.stringify(filtersToSave));
  }, [filterStartDate, filterEndDate, filterStatus, filterPaymentMethod, filterUploadedBy]);
  
  // Modal states
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [modalExcel, setModalExcel] = useState<{url: string, name: string} | null>(null);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [cellSum, setCellSum] = useState<number>(0);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    const init = async () => {
      const { session } = await auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // Check if admin
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      
      setIsAdmin(profile?.role === 'admin');
      setCurrentUserId(session.user.id);

      await Promise.all([loadDeposits(), loadPaymentMethods()]);
      setLoading(false);
    };

    init();
  }, [router]);

  const loadDeposits = async () => {
    try {
      // First get deposits
      const { data: depositsData, error } = await supabase
        .from('deposits')
        .select(`
          *,
          payment_methods:payment_method_id (name_en)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get user emails from user_profiles
      const userIds = [...new Set((depositsData || []).map(d => d.user_id))];
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds);
      
      const userEmailMap = new Map();
      if (profiles) {
        profiles.forEach(profile => {
          userEmailMap.set(profile.id, profile.email);
        });
      }
      
      // Parse proof_files JSON and add user_email
      const depositsWithFiles = (depositsData || []).map(d => ({
        ...d,
        user_email: userEmailMap.get(d.user_id) || 'Unknown User',
        proof_files: d.proof_file_url ? JSON.parse(d.proof_file_url) : [],
        method_group: d.method_group || []
      }));
      
      console.log('✅ Loaded', depositsWithFiles.length, 'deposits. Users:', [...userEmailMap.values()]);
      setDeposits(depositsWithFiles);
      setFilteredDeposits(depositsWithFiles);
    } catch (err: any) {
      console.error('Error loading deposits:', err);
    }
  };

  const loadPersistentNotes = async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_note', {
        p_note_type: 'deposits',
        p_note_key: 'general'
      });

      if (error) {
        console.warn('Could not load persistent notes from database:', error);
        return;
      }

      if (data) {
        setPersistentNotes(data);
        console.log('📝 Loaded persistent notes from database');
      }
    } catch (err: any) {
      console.warn('Error loading persistent notes:', err);
    }
  };

  const savePersistentNotes = async () => {
    try {
      const { error } = await supabase.rpc('upsert_user_note', {
        p_note_type: 'deposits',
        p_note_key: 'general',
        p_content: persistentNotes
      });

      if (error) {
        console.warn('Could not save persistent notes to database:', error);
      } else {
        console.log('💾 Saved persistent notes to database');
      }
    } catch (err: any) {
      console.warn('Error saving persistent notes:', err);
    }
  };

  useEffect(() => {
    applyFilters();
  }, [deposits, filterStartDate, filterEndDate, filterStatus, filterPaymentMethod, filterUploadedBy]);

  // Load preview cache from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('deposits_allocation_preview');
      if (saved) {
        const parsed = JSON.parse(saved);
        setAllocationPreview(parsed);
        console.log('🔁 Loaded allocation preview cache from localStorage', Object.keys(parsed).length);
      }
    } catch (e) {
      console.warn('Could not load allocation preview from localStorage:', e);
    }
  }, []);

  // Load persistent notes from database on mount
  useEffect(() => {
    loadPersistentNotes();
  }, []);

  // Save persistent notes to database whenever they change
  useEffect(() => {
    if (persistentNotes !== undefined) {
      savePersistentNotes();
    }
  }, [persistentNotes]);

  // Auto-preview pending deposits in the current filtered set so the previews "always exist" while pending
  useEffect(() => {
    if (!filteredDeposits || filteredDeposits.length === 0) return;
    const pending = filteredDeposits.filter(d => d.status === 'pending');
    if (pending.length === 0) return;
    console.log('⚡ Auto-prefetching previews for', pending.length, 'pending deposits');
    pending.forEach(d => {
      if (!allocationPreview[d.id]) {
        // fire and forget
        previewAllocation(d).catch(err => console.warn('Auto-preview failed for', d.id, err));
      }
    });
  }, [filteredDeposits]);

  const applyFilters = () => {
    let filtered = [...deposits];

    // Date range filter with overlap detection
    if (filterStartDate && filterEndDate) {
      const filterStart = new Date(filterStartDate);
      const filterEnd = new Date(filterEndDate);
      
      filtered = filtered.filter(deposit => {
        const depositStart = new Date(deposit.start_date);
        const depositEnd = new Date(deposit.end_date);
        
        // Check if ranges overlap
        return !(depositEnd < filterStart || depositStart > filterEnd);
      });
    }

    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(d => d.status === filterStatus);
    }

    // Payment method filter
    if (filterPaymentMethod !== 'all') {
      filtered = filtered.filter(d => d.payment_method_id === filterPaymentMethod);
    }
    
    // Uploaded By filter
    if (filterUploadedBy !== 'all') {
      filtered = filtered.filter(d => d.user_email === filterUploadedBy);
    }

    setFilteredDeposits(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const loadPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .order('name_en');

      if (error) throw error;
      setPaymentMethods(data || []);
    } catch (err: any) {
      console.error('Error loading payment methods:', err);
    }
  };

  // Load deposit settings for a specific payment method
  const loadDepositSettings = async (methodId: string) => {
    try {
      const { data, error } = await supabase
        .from('payment_method_deposit_settings')
        .select('*')
        .eq('payment_method_id', methodId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data) {
        console.log('✅ Loaded deposit settings for method:', methodId, data);
        setMethodTaxSettings(data);
        setTaxEnabled(data.tax_enabled || false);
        setTaxMethod(data.tax_method || 'none');
        setTaxValue(data.tax_value);
        setTaxColumnName(data.tax_column_name);
      } else {
        console.log('ℹ️ No deposit settings found for method:', methodId);
        setMethodTaxSettings(null);
        setTaxEnabled(false);
        setTaxMethod('none');
        setTaxValue(undefined);
        setTaxColumnName(undefined);
      }
    } catch (err: any) {
      console.error('Error loading deposit settings:', err);
      setMethodTaxSettings(null);
    }
  };

  // Handle payment method selection
  const handlePaymentMethodChange = async (methodId: string) => {
    setPaymentMethodId(methodId);
    await loadDepositSettings(methodId);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const uploadFiles = async (depositId: string, userId: string): Promise<UploadedFile[]> => {
    const fileUrls: UploadedFile[] = [];
    
    for (const file of files) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${depositId}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('deposits')
        .upload(fileName, file);

      if (error) {
        console.error('File upload error:', error);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from('deposits')
        .getPublicUrl(fileName);

      fileUrls.push({
        name: file.name,
        url: urlData.publicUrl,
        type: file.type,
        size: file.size
      });
    }

    return fileUrls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!startDate || !endDate || !totalAmount || !paymentMethodId) {
      alert('Please fill all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const { session } = await auth.getSession();
      const total = parseFloat(totalAmount);
      const tax = parseFloat(taxAmount || '0');
      const net = total + tax;

      // Insert deposit first
      const { data: depositData, error: depositError } = await supabase
        .from('deposits')
        .insert({
          user_id: session!.user.id,
          start_date: startDate,
          end_date: endDate,
          total_amount: total,
          tax_amount: tax,
          net_amount: net,
          payment_method_id: paymentMethodId,
          payment_method_name: paymentMethods.find(pm => pm.id === paymentMethodId)?.name_en,
          notes,
          status: 'pending'
        })
        .select()
        .single();

      if (depositError) throw depositError;

      // Upload files if any
      let fileUrls: UploadedFile[] = [];
      if (files.length > 0) {
        console.log('📤 Uploading files for deposit:', depositData.id);
        fileUrls = await uploadFiles(depositData.id, session!.user.id);
        console.log('✅ Files uploaded:', fileUrls);
        
        // Update deposit with file URLs
        const { error: updateError } = await supabase
          .from('deposits')
          .update({ proof_file_url: JSON.stringify(fileUrls) })
          .eq('id', depositData.id);

        if (updateError) {
          console.error('❌ Error updating file URLs:', updateError);
        } else {
          console.log('✅ File URLs saved to database');
        }
      }

      alert('Deposit submitted successfully! Waiting for admin approval.');
      resetForm();
      await loadDeposits();
    } catch (err: any) {
      alert('Failed to submit deposit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingDeposit(null);
    setStartDate('');
    setEndDate('');
    setTotalAmount('');
    setTaxAmount('');
    setPaymentMethodId('');
    setNotes('');
    setFiles([]);
    setUploadedFiles([]);
    setMethodTaxSettings(null);
    setTaxEnabled(false);
    setTaxMethod('none');
    setTaxValue(undefined);
    setTaxColumnName(undefined);
  };

  const handleEdit = (deposit: Deposit) => {
    setEditingDeposit(deposit);
    setStartDate(deposit.start_date);
    setEndDate(deposit.end_date);
    setTotalAmount(deposit.total_amount.toString());
    setTaxAmount(deposit.tax_amount.toString());
    setPaymentMethodId(deposit.payment_method_id);
    setNotes(deposit.notes || '');
    setUploadedFiles((deposit.proof_files as any[]) || []);
    // Load settings for the payment method
    loadDepositSettings(deposit.payment_method_id);
    setShowForm(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDeposit) return;

    setSubmitting(true);
    try {
      const total = parseFloat(totalAmount);
      const tax = parseFloat(taxAmount || '0');
      const net = total + tax;

      // Upload new files if any
      let allFiles = [...uploadedFiles];
      if (files.length > 0) {
        const { session } = await auth.getSession();
        const newFiles = await uploadFiles(editingDeposit.id, session!.user.id);
        allFiles = [...allFiles, ...newFiles];
      }

      const { error } = await supabase
        .from('deposits')
        .update({
          start_date: startDate,
          end_date: endDate,
          total_amount: total,
          tax_amount: tax,
          net_amount: net,
          payment_method_id: paymentMethodId,
          payment_method_name: paymentMethods.find(pm => pm.id === paymentMethodId)?.name_en,
          notes,
          proof_file_url: JSON.stringify(allFiles)
        })
        .eq('id', editingDeposit.id);

      if (error) throw error;

      alert('Deposit updated successfully!');
      resetForm();
      await loadDeposits();
    } catch (err: any) {
      alert('Failed to update deposit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const loadExcelPreview = async (url: string, name: string) => {
    setModalExcel({url, name});
    setLoadingExcel(true);
    setSelectedCells(new Set());
    setCellSum(0);
    
    try {
      const XLSX = await import('xlsx');
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
      
      setExcelData(jsonData as any[][]);
    } catch (err) {
      console.error('Error loading Excel:', err);
      alert('Failed to load Excel file');
      setModalExcel(null);
    } finally {
      setLoadingExcel(false);
    }
  };

  const formatExcelValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '';
    
    // Check if it's an Excel date serial number (between 1 and 60000)
    if (typeof value === 'number' && value > 1 && value < 60000 && Number.isInteger(value)) {
      // Convert Excel serial date to JavaScript date
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + value * 86400000);
      return jsDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    
    return String(value);
  };

  const handleCellClick = (rowIdx: number, cellIdx: number, value: any) => {
    const cellKey = `${rowIdx}-${cellIdx}`;
    const newSelected = new Set(selectedCells);
    
    if (newSelected.has(cellKey)) {
      newSelected.delete(cellKey);
    } else {
      newSelected.add(cellKey);
    }
    
    setSelectedCells(newSelected);
    
    // Calculate sum of selected numeric cells
    let sum = 0;
    newSelected.forEach(key => {
      const [r, c] = key.split('-').map(Number);
      const val = excelData[r]?.[c];
      const numVal = parseFloat(val);
      if (!isNaN(numVal)) {
        sum += numVal;
      }
    });
    
    setCellSum(sum);
  };

  const clearSelection = () => {
    setSelectedCells(new Set());
    setCellSum(0);
  };

  const downloadCSV = () => {
    if (filteredDeposits.length === 0) {
      alert('No deposits to download');
      return;
    }

    // Prepare CSV headers
    const headers = [
      'Deposit ID',
      'User Email',
      'Start Date',
      'End Date',
      'Payment Method',
      'Grouped',
      'Group Sequence',
      'Group Size',
      'Method Index',
      'Total Amount (EGP)',
      'Tax Amount (EGP)',
      'Net Amount (EGP)',
      'Gap Uncovered (EGP)',
      'Remaining Amount (EGP)',
      'Status',
      'Notes',
      'Created Date'
    ];

    // Prepare CSV rows - expand deposits by method_group (one row per method)
    const rows: string[][] = [];
    filteredDeposits.forEach(deposit => {
      const isGrouped = Boolean(deposit.method_group && deposit.method_group.length > 0);
      const methods = isGrouped
        ? (deposit.method_group as Array<{ payment_method_id?: string; name_en?: string }>)
        : [{ name_en: deposit.payment_methods?.name_en || deposit.payment_method_name || 'N/A' }];

      methods.forEach((m, idx) => {
        const groupSequence = methods.map(x => x.name_en || x.payment_method_id || 'N/A').join(' → ');
        const groupSize = methods.length;
        const methodIndex = idx + 1;

        rows.push([
          deposit.id || '',
          deposit.user_email || 'Unknown',
          new Date(deposit.start_date).toLocaleDateString(),
          new Date(deposit.end_date).toLocaleDateString(),
          m.name_en || 'N/A',
          isGrouped ? 'Yes' : 'No',
          groupSequence,
          String(groupSize),
          String(methodIndex),
          (typeof deposit.total_amount === 'number' ? deposit.total_amount.toFixed(2) : deposit.total_amount || '0'),
          (typeof deposit.tax_amount === 'number' ? deposit.tax_amount.toFixed(2) : deposit.tax_amount || '0'),
          (typeof deposit.net_amount === 'number' ? deposit.net_amount.toFixed(2) : deposit.net_amount || '0'),
          (typeof deposit.gap_uncovered === 'number' ? deposit.gap_uncovered.toFixed(2) : (deposit.gap_uncovered || '-')),
          (typeof deposit.remaining_amount === 'number' ? deposit.remaining_amount.toFixed(2) : (deposit.remaining_amount || '-')),
          deposit.status,
          (deposit.notes || '').replace(/"/g, '""'), // Escape quotes
          new Date(deposit.created_at).toLocaleDateString()
        ]);
      });
    });

    // Create CSV content
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deposits_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    console.log('✅ Downloaded', filteredDeposits.length, 'deposits as CSV');
  };

  const handleDelete = async (depositId: string) => {
    if (!confirm('Are you sure you want to delete this deposit?')) return;

    setDeletingIds(prev => {
      const next = new Set(prev);
      next.add(depositId);
      return next;
    });

    try {
      console.log('🗑️ Deleting deposit:', depositId);
      
      // Delete and return deleted rows to know if RLS allowed it
      const { data, error } = await supabase
        .from('deposits')
        .delete()
        .eq('id', depositId)
        .select('id');

      if (error) {
        console.error('❌ Delete error:', error);
        alert('Failed to delete: ' + error.message);
        return;
      }

      const deletedCount = data ? data.length : 0;
      console.log(`Requested 1 deletion, actually deleted ${deletedCount}`);

      if (deletedCount === 1) {
        alert('Deposit deleted successfully!');
      } else {
        alert('No deposits were deleted. You may not have permission to delete this record.');
      }

      await loadDeposits();
    } catch (err: any) {
      console.error('❌ Delete failed:', err);
      alert('Failed to delete: ' + err.message);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(depositId);
        return next;
      });
    }
  };

  // Delete all deposits (admin only) - delete only currently filtered deposits for safety
  const handleDeleteAll = async () => {
    const ids = filteredDeposits.map(d => d.id);
    if (ids.length === 0) {
      alert('No deposits to delete');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${ids.length} deposit(s)? This cannot be undone.`)) return;

    try {
      // Delete by list of IDs and return deleted rows
      const { data, error } = await supabase
        .from('deposits')
        .delete()
        .in('id', ids)
        .select('id');

      if (error) {
        alert('Failed to delete deposits: ' + error.message);
        console.error('DeleteAll error:', error);
        return;
      }

      const deletedCount = data ? data.length : 0;
      console.log(`Requested ${ids.length} deletions, actually deleted ${deletedCount}`);

      if (deletedCount === ids.length) {
        alert(`${deletedCount} deposits deleted successfully!`);
      } else if (deletedCount > 0) {
        alert(`Deleted ${deletedCount} deposits. ${ids.length - deletedCount} could not be deleted (permissions or constraints).`);
      } else {
        alert('No deposits were deleted. You may not have permission to delete some records.');
      }

      await loadDeposits();
    } catch (err: any) {
      alert('Failed to delete deposits: ' + err.message);
      console.error('DeleteAll catch:', err);
    }
  };

  // Delete deposits by status (admin only) - pending or approved
  const handleDeleteByStatus = async (status: 'pending' | 'approved') => {
    const ids = deposits.filter(d => d.status === status).map(d => d.id);
    if (ids.length === 0) {
      alert(`No ${status} deposits to delete`);
      return;
    }

    if (!confirm(`Are you sure you want to delete ${ids.length} ${status} deposit(s)? This cannot be undone.`)) return;

    try {
      // Delete by list of IDs and return deleted rows
      const { data, error } = await supabase
        .from('deposits')
        .delete()
        .in('id', ids)
        .select('id');

      if (error) {
        alert('Failed to delete deposits: ' + error.message);
        console.error(`DeleteByStatus (${status}) error:`, error);
        return;
      }

      const deletedCount = data ? data.length : 0;
      console.log(`Requested ${ids.length} deletions for status=${status}, actually deleted ${deletedCount}`);

      if (deletedCount === ids.length) {
        alert(`${deletedCount} ${status} deposits deleted successfully!`);
      } else if (deletedCount > 0) {
        alert(`Deleted ${deletedCount} ${status} deposits. ${ids.length - deletedCount} could not be deleted (permissions or constraints).`);
      } else {
        alert(`No ${status} deposits were deleted. You may not have permission to delete some records.`);
      }

      await loadDeposits();
    } catch (err: any) {
      alert('Failed to delete deposits: ' + err.message);
      console.error(`DeleteByStatus (${status}) catch:`, err);
    }
  };

  const handleApprove = async (depositId: string) => {
    try {
      const { session } = await auth.getSession();
      const { error } = await supabase
        .from('deposits')
        .update({
          status: 'approved',
          reviewed_by: session!.user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', depositId);

      if (error) throw error;

      // After approving, call populate_deposit_allocations to create detailed allocation rows
      try {
        console.log('🔄 Populating allocations for approved deposit', depositId);
        const { error: popErr } = await supabase.rpc('populate_deposit_allocations', { p_deposit_id: depositId });
        if (popErr) {
          console.error('Failed to populate_deposit_allocations after approve:', popErr);
          alert('Warning: allocations refresh failed after approve: ' + (popErr.message || JSON.stringify(popErr)));
        } else {
          console.log('✅ populate_deposit_allocations completed for', depositId);
        }
      } catch (rpcErr) {
        console.error('Exception while calling populate_deposit_allocations:', rpcErr);
      }

      await loadDeposits();
    } catch (err: any) {
      alert('Failed to approve: ' + err.message);
    }
  };

  const handleReject = async (depositId: string) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
      const { session } = await auth.getSession();
      const { error } = await supabase
        .from('deposits')
        .update({
          status: 'rejected',
          reviewed_by: session!.user.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason
        })
        .eq('id', depositId);

      if (error) throw error;
      await loadDeposits();
    } catch (err: any) {
      alert('Failed to reject: ' + err.message);
    }
  };

  // Preview allocation for a deposit (does not change DB)
  const previewAllocation = async (deposit: Deposit, force: boolean = false) => {
    if (allocationPreview[deposit.id] && !force) {
      console.log('🔁 Preview cache hit for deposit', deposit.id, allocationPreview[deposit.id]);
      return; // already cached
    }

    setPreviewLoadingIds(prev => {
      const next = new Set(prev);
      next.add(deposit.id);
      return next;
    });

    if (force) console.log('🔄 Forcing preview refresh for deposit', deposit.id);

    try {
      console.log('🔍 Previewing allocation for deposit', deposit.id, {
        start_date: deposit.start_date,
        end_date: deposit.end_date
      });

      // If deposit has an ordered method_group, compute allocations sequentially
      const group = (deposit as any).method_group as Array<{payment_method_id: string; name_en?: string; name?: string}> | undefined;

      if (group && group.length > 0) {
        console.log('🔀 deposit has method_group:', group.map(g => g.payment_method_id));
        const safeNumber = (v: any) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };
        let remainingAmount = safeNumber(deposit.net_amount);
        const per_method: MethodPreview[] = [];
        let total_gap_covered = 0;

        for (const m of group) {
          // Prefer server-side method summary (net_invoices and approved_alloc) for method-specific gap
          try {
            // Resolve payment method id (support UUID or name/id-text forms in method_group)
            let resolvedPmId: string | null = null;
            const isUuid = (val: any) => typeof val === 'string' && /^[0-9a-fA-F-]{36}$/.test(val);

            if (m.payment_method_id && isUuid(m.payment_method_id)) {
              resolvedPmId = m.payment_method_id;
            } else {
              // try to resolve by id-text or name fields
              const lookupVal = (m.payment_method_id || m.name_en || m.name || '').trim();
              if (lookupVal) {
                const { data: pmRows } = await supabase
                  .from('payment_methods')
                  .select('id,name_en,name')
                  .or(`id.eq.${lookupVal},name.ilike.%${lookupVal}%,name_en.ilike.%${lookupVal}%`)
                  .limit(1);

                if (pmRows && pmRows.length > 0) {
                  resolvedPmId = pmRows[0].id;
                  console.log('🔎 Resolved method group item to id', lookupVal, '->', resolvedPmId);
                }
              }
            }

            const { data: methodSummary, error: msError } = await supabase.rpc('get_method_summaries', {
              p_start_date: deposit.start_date,
              p_end_date: deposit.end_date,
              p_payment_method_id: resolvedPmId || null
            });

            if (msError) {
              console.error('get_method_summaries RPC error for method', m.payment_method_id, msError);
              throw msError;
            }

            // If we passed null and got multiple rows, try to pick matching name if available
            let ms: any = null;
            if (Array.isArray(methodSummary)) {
              if (resolvedPmId) {
                ms = methodSummary.find((r: any) => r.payment_method_id === resolvedPmId) || methodSummary[0] || null;
              } else if (m.name_en || m.name) {
                const nameMatch = (m.name_en || m.name || '').toLowerCase();
                ms = methodSummary.find((r: any) => (r.name || '').toLowerCase().includes(nameMatch)) || methodSummary[0] || null;
              } else {
                ms = methodSummary[0] || null;
              }
            } else {
              ms = (methodSummary && methodSummary[0]) || null;
            }

            const netInvoices = ms ? Number(ms.net_invoices || 0) : 0;
            const approvedAlloc = ms ? Number(ms.approved_alloc || 0) : 0;

            // Gap per method = net_invoices - approved_alloc (per your requested change)
            let v_gap = Math.max(0, netInvoices - approvedAlloc);

            // If we found no gap from methodSummaries, double-check with calculate_gap_in_period (more accurate when allocations exist)
            if (v_gap === 0 && resolvedPmId) {
              try {
                const { data: gapData, error: gapErr } = await supabase.rpc('calculate_gap_in_period', {
                  p_start_date: deposit.start_date,
                  p_end_date: deposit.end_date,
                  p_payment_method_id: resolvedPmId,
                  p_exclude_deposit_id: null,
                  p_use_latest: true
                });

                if (!gapErr) {
                  v_gap = Number(gapData) || 0;
                  if (v_gap > 0) console.log('🔍 calculate_gap_in_period returned gap for', resolvedPmId, v_gap);
                } else {
                  console.warn('calculate_gap_in_period rpc error while checking fallback gap for', resolvedPmId, gapErr);
                }
              } catch (e) {
                console.warn('Exception calling calculate_gap_in_period fallback for', resolvedPmId, e);
              }
            }

            // Always show pre-existing gap (gap_available) even when remainingAmount is 0
            const gapAvailable = safeNumber(v_gap);

            if (remainingAmount <= 0) {
              per_method.push({
                payment_method_id: resolvedPmId || m.payment_method_id,
                name: m.name_en || m.name,
                gap_available: gapAvailable,
                gap_covered: 0,
                gap_uncovered: gapAvailable,
                remaining: 0
              });
              continue;
            }

            // this method can cover at most v_gap, but not more than remainingAmount
            const gap_covered_for_method = Math.min(remainingAmount, v_gap);
            remainingAmount = remainingAmount - gap_covered_for_method;

            let gap_uncovered_for_method = Math.max(0, v_gap - gap_covered_for_method);

            // numeric safety
            const safe_v_gap_main = safeNumber(v_gap);
            const safe_gap_covered_main = safeNumber(gap_covered_for_method);
            gap_uncovered_for_method = Number.isFinite(gap_uncovered_for_method) ? gap_uncovered_for_method : Math.max(0, safe_v_gap_main - safe_gap_covered_main);

            per_method.push({
              payment_method_id: resolvedPmId || m.payment_method_id,
              name: m.name_en || m.name,
              gap_available: safe_v_gap_main,
              gap_covered: safe_gap_covered_main,
              gap_uncovered: safeNumber(gap_uncovered_for_method),
              remaining: safeNumber(remainingAmount)
            });

            total_gap_covered += safe_gap_covered_main;
          } catch (rpcErr) {
            console.warn('Falling back to calculate_gap_in_period for method', m.payment_method_id, rpcErr);

            // Fallback to existing allocate-in-period semantics
            const { data, error } = await supabase.rpc('calculate_gap_in_period', {
              p_start_date: deposit.start_date,
              p_end_date: deposit.end_date,
              p_payment_method_id: m.payment_method_id || null,
              p_exclude_deposit_id: null, // include this deposit's allocations in the preview
              p_use_latest: true
            });

            if (error) {
              console.error('RPC error for method fallback', m.payment_method_id, error);
              throw error;
            }

            const v_gap = Number(data) || 0;

            const gap_covered_for_method = Math.min(remainingAmount, v_gap);
            remainingAmount = remainingAmount - gap_covered_for_method;

            let gap_uncovered_for_method = Math.max(0, v_gap - gap_covered_for_method);

            // ensure numeric safety
            const safe_v_gap = safeNumber(v_gap);
            const safe_gap_covered = safeNumber(gap_covered_for_method);
            gap_uncovered_for_method = Number.isFinite(gap_uncovered_for_method) ? gap_uncovered_for_method : Math.max(0, safe_v_gap - safe_gap_covered);

            per_method.push({
              payment_method_id: m.payment_method_id,
              name: m.name_en || m.name,
              gap_available: safe_v_gap,
              gap_covered: safe_gap_covered,
              gap_uncovered: safeNumber(gap_uncovered_for_method),
              remaining: safeNumber(remainingAmount)
            });

            total_gap_covered += safe_gap_covered;
          }
        }

        const total_remaining = Math.max(0, safeNumber(deposit.net_amount) - total_gap_covered);
        const total_gap_uncovered = per_method.reduce((acc, pm) => acc + safeNumber(pm.gap_uncovered), 0);

        const preview: AllocationPreview = {
          gap_covered: total_gap_covered,
          gap_uncovered: total_gap_uncovered,
          remaining: total_remaining,
          per_method
        };

        setAllocationPreview(prev => {
          const next = { ...prev, [deposit.id]: preview };
          try {
            localStorage.setItem('deposits_allocation_preview', JSON.stringify(next));
            console.log('💾 Saved preview to localStorage for', deposit.id);
          } catch (e) {
            console.warn('Could not save preview to localStorage:', e);
          }
          return next;
        });

        // record time of refresh
        const nowIso = new Date().toISOString();
        setAllocationPreviewTimes(prev => ({ ...prev, [deposit.id]: nowIso }));

// Trigger background allocations refresh (non-blocking) - only for approved deposits
        (async () => {
          try {
            if (deposit.status !== 'approved') {
              console.log('Not triggering background allocations refresh - deposit not approved:', deposit.id);
              return;
            }

            // Avoid frequent refreshes
            const last = allocationRefreshTimes[deposit.id];
            // If force is true, bypass the throttle and refresh immediately
            if (!force && last && (new Date().getTime() - new Date(last).getTime()) < MIN_REFRESH_INTERVAL_MS) {
              console.log('Skipping background allocation refresh for', deposit.id, '— refreshed recently (use force to bypass)');
              return;
            } else if (force && last) {
              console.log('Force refresh requested — bypassing throttle for', deposit.id);
            }

            setAllocationRefreshingIds(prev => new Set([...Array.from(prev), deposit.id]));
            console.log('🔄 Background: populating deposit allocations for', deposit.id);
            const { error } = await supabase.rpc('populate_deposit_allocations', { p_deposit_id: deposit.id });
            if (error) {
              console.error('Background populate_deposit_allocations error for', deposit.id, error);
            } else {
              console.log('Background populate_deposit_allocations completed for', deposit.id);
              setAllocationRefreshTimes(prev => ({ ...prev, [deposit.id]: new Date().toISOString() }));
            }
          } catch (err) {
            console.error('Background allocation refresh failed for', deposit.id, err);
          } finally {
            setAllocationRefreshingIds(prev => {
              const s = new Set(Array.from(prev).filter(x => x !== deposit.id));
              return s;
            });
          }
        })();

        console.log('🔢 Computed group preview for', deposit.id, preview);
        return;
      }

      // Fallback: original single-method calculation
      const { data, error } = await supabase.rpc('calculate_gap_in_period', {
        p_start_date: deposit.start_date,
        p_end_date: deposit.end_date,
        p_payment_method_id: deposit.payment_method_id || null,
        p_exclude_deposit_id: null, // include this deposit's allocations in the preview
        p_use_latest: true
      });
      if (error) throw error;
      console.log('📡 RPC calculate_gap_in_period result for', deposit.id, data);
      const v_gap_in_period = Number(data) || 0;
      let gap_covered = 0;
      let remaining = 0;
      if (deposit.net_amount <= v_gap_in_period) {
        gap_covered = deposit.net_amount;
        remaining = 0;
      } else {
        gap_covered = v_gap_in_period;
        remaining = deposit.net_amount - v_gap_in_period;
      }
      const gap_uncovered = Math.max(0, v_gap_in_period - gap_covered);
      console.log('🔢 Computed preview for', deposit.id, { gap_covered, gap_uncovered, remaining });
      const per_method: MethodPreview[] = [{
        payment_method_id: deposit.payment_method_id,
        name: deposit.payment_method_name,
        gap_available: v_gap_in_period,
        gap_covered,
        gap_uncovered,
        remaining
      }];

      const previewObj: AllocationPreview = { gap_covered, gap_uncovered, remaining, per_method };
      setAllocationPreview(prev => {
        const next = { ...prev, [deposit.id]: previewObj };
        try {
          localStorage.setItem('deposits_allocation_preview', JSON.stringify(next));
          console.log('💾 Saved preview to localStorage for', deposit.id);
        } catch (e) {
          console.warn('Could not save preview to localStorage:', e);
        }
        return next;
      });

      // record time of refresh
      const nowIso = new Date().toISOString();
      setAllocationPreviewTimes(prev => ({ ...prev, [deposit.id]: nowIso }));

      // Background refresh allocations (non-blocking)
      (async () => {
        try {
          const last = allocationRefreshTimes[deposit.id];
          // If force is true bypass throttle
          if (!force && last && (new Date().getTime() - new Date(last).getTime()) < MIN_REFRESH_INTERVAL_MS) {
            console.log('Skipping background allocation refresh for', deposit.id, '— refreshed recently (use force to bypass)');
          } else {
            if (force && last) console.log('Force refresh requested — bypassing throttle for', deposit.id);
            setAllocationRefreshingIds(prev => new Set([...Array.from(prev), deposit.id]));
            console.log('🔄 Background: populating deposit allocations for', deposit.id);
            const { error } = await supabase.rpc('populate_deposit_allocations', { p_deposit_id: deposit.id });
            if (error) console.error('Background populate_deposit_allocations error for', deposit.id, error);
            else setAllocationRefreshTimes(prev => ({ ...prev, [deposit.id]: new Date().toISOString() }));
          }
        } catch (err) {
          console.error('Background allocation refresh failed for', deposit.id, err);
        } finally {
          setAllocationRefreshingIds(prev => {
            const s = new Set(Array.from(prev).filter(x => x !== deposit.id));
            return s;
          });
        }
      })();

      console.log('✅ Preview cache updated for', deposit.id);
    } catch (err: any) {
      console.error('Preview allocation failed:', err);
      alert('Failed to preview allocation: ' + err.message);
    } finally {
      setPreviewLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(deposit.id);
        return next;
      });
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
      
      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-16 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Deposits</h1>
                <p className="text-gray-600 mt-1">
                  {isAdmin ? 'Review and approve deposit requests' : 'Submit deposit requests for approval'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {isAdmin && (
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  <Plus className="h-4 w-4" />
                  Admin Add Deposit
                </button>
              )}
              {!isAdmin && (
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" />
                  New Deposit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Deposits Navigation Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-8">
            <button
              onClick={() => router.push('/deposits')}
              className="px-0 py-3 border-b-2 border-primary-600 text-primary-600 font-medium"
            >
              Deposits
            </button>
            {isAdmin && (
              <button
                onClick={() => router.push('/deposits/settings')}
                className="px-0 py-3 border-b-2 border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 font-medium"
              >
                Settings
              </button>
            )}
          </nav>
        </div>        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
              <select
                value={filterPaymentMethod}
                onChange={(e) => setFilterPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Methods</option>
                {paymentMethods.map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.name_en}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Uploaded By</label>
              <select
                value={filterUploadedBy}
                onChange={(e) => setFilterUploadedBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Users</option>
                {[...new Set(deposits.map(d => d.user_email))].map(email => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => {
              setFilterStartDate('');
              setFilterEndDate('');
              setFilterStatus('all');
              setFilterPaymentMethod('all');
              setFilterUploadedBy('all');
            }}
            className="mt-4 text-sm text-gray-600 hover:text-gray-900"
          >
            Clear Filters
          </button>
        </div>

        {/* Persistent Notes Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Notes</h2>
            <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">Cloud Saved</span>
          </div>
          <textarea
            value={persistentNotes}
            onChange={(e) => setPersistentNotes(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-vertical"
            placeholder="Add your notes here... They will be saved to the cloud and available on all your devices."
          />
          <div className="mt-2 text-xs text-gray-500">
            ☁️ Your notes are automatically saved to the cloud and will be available on all your devices.
          </div>
        </div>

        {/* New Deposit Form - User or Admin */}
        {showForm && (
          isAdmin ? (
            <AdminInlineDepositForm
              onClose={() => setShowForm(false)}
              onSuccess={() => {
                loadDeposits();
                setShowForm(false);
              }}
              currentUserId={currentUserId}
              paymentMethods={paymentMethods}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {editingDeposit ? 'Edit Deposit' : 'Submit New Deposit'}
            </h2>
            <form onSubmit={editingDeposit ? handleUpdate : handleSubmit}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (EGP) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tax Amount (EGP)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
                  <select
                    value={paymentMethodId}
                    onChange={(e) => handlePaymentMethodChange(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select method...</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name_en}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Net Amount</label>
                  <input
                    type="text"
                    value={(parseFloat(totalAmount || '0') + parseFloat(taxAmount || '0')).toFixed(2)}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-900 font-semibold"
                  />
                </div>
              </div>

              {/* Tax Configuration Display from Settings */}
              {paymentMethodId && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="text-sm font-semibold text-blue-900 mb-4">💰 Tax Configuration</h3>
                  
                  {methodTaxSettings ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
                        <div>
                          <span className="text-blue-700 font-medium">Status:</span>
                          <span className={`ml-2 font-semibold ${methodTaxSettings.tax_enabled ? 'text-green-600' : 'text-gray-600'}`}>
                            {methodTaxSettings.tax_enabled ? '✓ Enabled' : '✗ Disabled'}
                          </span>
                        </div>
                        {methodTaxSettings.tax_enabled && (
                          <>
                            <div>
                              <span className="text-blue-700 font-medium">Method:</span>
                              <span className="ml-2 text-gray-700 font-medium">
                                {(methodTaxSettings.tax_method === 'fixed_percent' || methodTaxSettings.tax_method === 'percentage') && '📊 Fixed Percentage'}
                                {(methodTaxSettings.tax_method === 'fixed_amount' || methodTaxSettings.tax_method === 'amount') && '💵 Fixed Amount'}
                                {methodTaxSettings.tax_method === 'column_based' && '📋 Column Based'}
                              </span>
                            </div>
                            {(methodTaxSettings.tax_method === 'fixed_percent' || methodTaxSettings.tax_method === 'percentage' || methodTaxSettings.tax_method === 'fixed_amount' || methodTaxSettings.tax_method === 'amount') && (
                              <div>
                                <span className="text-blue-700 font-medium">Value:</span>
                                <span className="ml-2 font-bold text-green-700 text-base">
                                  {methodTaxSettings.tax_value}
                                  {(methodTaxSettings.tax_method === 'fixed_percent' || methodTaxSettings.tax_method === 'percentage') && '%'}
                                  {(methodTaxSettings.tax_method === 'fixed_amount' || methodTaxSettings.tax_method === 'amount') && ' EGP'}
                                </span>
                              </div>
                            )}
                            {methodTaxSettings.tax_method === 'column_based' && (
                              <div>
                                <span className="text-blue-700 font-medium">Column Name:</span>
                                <span className="ml-2 font-bold text-green-700 text-base">{methodTaxSettings.tax_column_name}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <p className="text-xs text-blue-600 mt-2">
                        ✅ Tax will be auto-calculated based on configuration
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-blue-700 mb-3">
                        ⚠️ No tax configuration found for this payment method
                      </p>
                      <p className="text-xs text-blue-600">
                        Set up tax configuration in the <span className="font-semibold">Settings</span> tab to enable auto-fill
                      </p>
                    </>
                  )}
                </div>
              )}
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Add any additional notes..."
                />
              </div>
              
              {/* File Upload */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Upload className="inline h-4 w-4 mr-1" />
                  Upload Files (CSV, Excel, Images, Documents)
                </label>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  accept=".csv,.xlsx,.xls,.txt,.doc,.docx,.pdf,.jpg,.jpeg,.png,.gif"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
                {files.length > 0 && (
                  <div className="mt-2 text-sm text-gray-600">
                    {files.length} file(s) selected
                  </div>
                )}
                {uploadedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} className="text-sm text-gray-600 flex items-center gap-2">
                        <File className="h-3 w-3" />
                        {file.name}
                        <button
                          type="button"
                          onClick={() => setUploadedFiles(uploadedFiles.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {submitting ? (editingDeposit ? 'Updating...' : 'Submitting...') : (editingDeposit ? 'Update Deposit' : 'Submit for Approval')}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
            </div>
          )
        )}

        {/* Deposits List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Header with Download Button and Pagination Info */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold text-gray-900">Deposits</h3>
              <span className="text-sm text-gray-600">
                Total: <span className="font-medium">{filteredDeposits.length}</span> deposits
              </span>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  {filteredDeposits.length > 0 && (
                    <button
                      onClick={handleDeleteAll}
                      className="flex items-center gap-2 px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete All
                    </button>
                  )}

                  {/* Delete all pending */}
                  {deposits.some(d => d.status === 'pending') && (
                    <button
                      onClick={() => handleDeleteByStatus('pending')}
                      className="flex items-center gap-2 px-3 py-1 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-xs"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Pending
                    </button>
                  )}

                  {/* Delete all approved */}
                  {deposits.some(d => d.status === 'approved') && (
                    <button
                      onClick={() => handleDeleteByStatus('approved')}
                      className="flex items-center gap-2 px-3 py-1 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-xs"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Approved
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={downloadCSV}
              disabled={filteredDeposits.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
          </div>
          <div className="w-full overflow-x-auto">
            {/* Table uses auto layout by default and fixes on md+; allow horizontal scroll when needed */}
            <table className="w-full table-auto md:table-fixed divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8"></th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-32">Date Range</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-40">Payment Method</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Total</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-20">Tax</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Net Amount</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-32">Gap Uncovered</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Remaining</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Files</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Status</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDeposits.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-gray-500">
                      <Wallet className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No deposits found</p>
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const totalPages = Math.ceil(filteredDeposits.length / itemsPerPage);
                    const startIdx = (currentPage - 1) * itemsPerPage;
                    const endIdx = startIdx + itemsPerPage;
                    const paginatedDeposits = filteredDeposits.slice(startIdx, endIdx);
                    
                    return paginatedDeposits.map((deposit) => (
                    <React.Fragment key={deposit.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-3 py-3">
                          <button
                            onClick={() => setExpandedRow(expandedRow === deposit.id ? null : deposit.id)}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            {expandedRow === deposit.id ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </td>

                        <td className="px-3 py-3 text-sm text-gray-900 whitespace-normal">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {new Date(deposit.start_date).toLocaleDateString()} - {new Date(deposit.end_date).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-900 whitespace-normal break-words">
                          <div>{deposit.payment_methods?.name_en || deposit.payment_method_name || 'N/A'}</div>
                          {deposit.method_group && deposit.method_group.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1">
                              <span className="font-medium">Group:</span>&nbsp;{deposit.method_group.map((m: any) => m.name_en || m.payment_method_id).join(' → ')}
                              {allocationPreview[deposit.id]?.per_method ? (
                                <div className="mt-1 text-xs text-gray-700">
                                  <span className="font-medium">Preview:</span>&nbsp;{allocationPreview[deposit.id]!.per_method!.map(pm => {
                                    const gapStr = (typeof pm.gap_available === 'number') ? pm.gap_available.toLocaleString() : 'N/A';
                                    return `${pm.name || pm.payment_method_id} (Gap: ${gapStr} EGP خلال الفترة)`;
                                  }).join(' → ')}
                                  <span className="text-xs text-gray-500 ml-2">Rem: {typeof allocationPreview[deposit.id]!.remaining === 'number' ? allocationPreview[deposit.id]!.remaining.toLocaleString() + ' EGP' : 'N/A'}</span>

                                  {/* Allocation refresh status */}
                                  {allocationRefreshingIds.has(deposit.id) ? (
                                    <span className="text-xs text-blue-600 ml-3">Refreshing allocations…</span>
                                  ) : allocationRefreshTimes[deposit.id] ? (
                                    <span className="text-xs text-gray-400 ml-3">Allocations updated {new Date(allocationRefreshTimes[deposit.id]).toLocaleString()}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-gray-900">
                          {deposit.total_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-gray-900">
                          {deposit.tax_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-3 py-3 text-sm text-right font-semibold text-blue-600">
                          {deposit.net_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-red-600 font-medium">
                          {allocationPreview[deposit.id] && deposit.status !== 'approved' ? (
                            typeof allocationPreview[deposit.id]!.gap_uncovered === 'number' ? (
                              `${allocationPreview[deposit.id]!.gap_uncovered.toLocaleString()} EGP (preview)`
                            ) : (
                              <span className="text-gray-400">N/A (preview)</span>
                            )
                          ) : (typeof deposit.gap_uncovered === 'number' ? (
                            `${deposit.gap_uncovered.toLocaleString()} EGP`
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          ))}
                        </td>
                        <td className="px-3 py-3 text-sm text-right text-orange-600 font-medium">
                          {allocationPreview[deposit.id] && deposit.status !== 'approved' ? (
                            typeof allocationPreview[deposit.id]!.remaining === 'number' ? (
                              `${allocationPreview[deposit.id]!.remaining.toLocaleString()} EGP (preview)`
                            ) : (
                              <span className="text-gray-400">N/A (preview)</span>
                            )
                          ) : (typeof deposit.remaining_amount === 'number' ? (
                            `${deposit.remaining_amount.toLocaleString()} EGP`
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          ))}
                        </td>
                        <td className="px-3 py-3 text-sm whitespace-normal">
                          {deposit.proof_files && deposit.proof_files.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {deposit.proof_files.map((file: any, idx: number) => (
                                <a
                                  key={idx}
                                  href={file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary-600 hover:underline flex items-center gap-1"
                                  download={file.name}
                                >
                                  <File className="h-4 w-4" />
                                  <span className="truncate max-w-[150px]">{file.name}</span>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">No files</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm whitespace-normal">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                            deposit.status === 'approved' ? 'bg-green-100 text-green-800' :
                            deposit.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {deposit.status === 'approved' && <CheckCircle className="h-3 w-3" />}
                            {deposit.status === 'rejected' && <XCircle className="h-3 w-3" />}
                            {deposit.status === 'pending' && <Clock className="h-3 w-3" />}
                            {deposit.status.charAt(0).toUpperCase() + deposit.status.slice(1)}
                          </span>
                          {deposit.rejection_reason && (
                            <p className="text-xs text-red-600 mt-1">{deposit.rejection_reason}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-right">
                          <div className="flex flex-wrap gap-2 justify-end items-center">
                            {isAdmin && deposit.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(deposit.id)}
                                  className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs whitespace-nowrap"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject(deposit.id)}
                                  className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs whitespace-nowrap"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                                            {deposit.status !== 'approved' && (
                          <div className="flex flex-col items-end">
                            <button
                              onClick={() => previewAllocation(deposit, true)}
                              className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs whitespace-nowrap"
                              disabled={previewLoadingIds.has(deposit.id)}
                              title="Preview allocation including this deposit (simulate approval)"
                            >
                              {previewLoadingIds.has(deposit.id) ? 'Previewing...' : 'Preview (refresh)'}
                            </button>
                            {allocationPreviewTimes[deposit.id] && (
                              <div className="text-xs text-gray-500 mt-1">Last refreshed: {new Date(allocationPreviewTimes[deposit.id]).toLocaleString()}</div>
                            )}
                          </div>
                        )}

                            {/* Admins: per-row Delete button for any status */}
                            {isAdmin && (
                              <button
                                onClick={() => handleDelete(deposit.id)}
                                className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs flex items-center gap-1 whitespace-nowrap"
                                disabled={deletingIds.has(deposit.id)}
                                title="Delete this deposit"
                              >
                                <Trash2 className="h-3 w-3" />
                                {deletingIds.has(deposit.id) ? 'Deleting...' : 'Delete'}
                              </button>
                            )}

                            {!isAdmin && deposit.status === 'pending' && deposit.user_id === currentUserId && (
                              <>
                                <button
                                  onClick={() => handleEdit(deposit)}
                                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs flex items-center gap-1"
                                >
                                  <Edit className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(deposit.id)}
                                  className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs flex items-center gap-1"
                                  disabled={deletingIds.has(deposit.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {deletingIds.has(deposit.id) ? 'Deleting...' : 'Delete'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      
                      {/* Expanded Row - File Preview */}
                      {expandedRow === deposit.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={11} className="px-3 py-4">
                            <div className="space-y-4">
                              {deposit.notes && (
                                <div>
                                  <h4 className="font-medium text-gray-900 mb-1">Notes:</h4>
                                  <p className="text-sm text-gray-700">{deposit.notes}</p>
                                </div>
                              )}
                              
                              {deposit.proof_files && deposit.proof_files.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-gray-900 mb-2">Attached Files:</h4>
                                  <div className="grid grid-cols-3 gap-4">
                                    {(deposit.proof_files as any[]).map((file: any, idx: number) => {
                                      const isImage = file.type?.startsWith('image/');
                                      const isExcel = file.name?.endsWith('.xlsx') || file.name?.endsWith('.xls');
                                      const isCsv = file.name?.endsWith('.csv');
                                      
                                      return (
                                        <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-white">
                                          <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                              {isImage ? (
                                                <ImageIcon className="h-5 w-5 text-blue-600" />
                                              ) : isExcel || isCsv ? (
                                                <FileText className="h-5 w-5 text-green-600" />
                                              ) : (
                                                <File className="h-5 w-5 text-gray-600" />
                                              )}
                                              <span className="text-sm font-medium text-gray-900 truncate">
                                                {file.name}
                                              </span>
                                            </div>
                                          </div>
                                          
                                          {isImage && (
                                            <img 
                                              src={file.url} 
                                              alt={file.name}
                                              className="w-full h-32 object-cover rounded mb-2 cursor-pointer hover:opacity-75 transition-opacity"
                                              onClick={() => setModalImage(file.url)}
                                            />
                                          )}
                                          
                                          <div className="flex gap-2">
                                            {isImage ? (
                                              <button
                                                onClick={() => setModalImage(file.url)}
                                                className="flex-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 flex items-center justify-center gap-1"
                                              >
                                                <Eye className="h-3 w-3" />
                                                View
                                              </button>
                                            ) : (isExcel || isCsv) ? (
                                              <button
                                                onClick={() => loadExcelPreview(file.url, file.name)}
                                                className="flex-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 flex items-center justify-center gap-1"
                                              >
                                                <Eye className="h-3 w-3" />
                                                Preview
                                              </button>
                                            ) : null}
                                            <a
                                              href={file.url}
                                              download={file.name}
                                              className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 flex items-center justify-center gap-1"
                                            >
                                              <Download className="h-3 w-3" />
                                              Download
                                            </a>
                                          </div>
                                          
                                          <div className="mt-2 text-xs text-gray-500">
                                            {(file.size / 1024).toFixed(1)} KB
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Per-method allocation preview (if present) */}
                              {allocationPreview[deposit.id]?.per_method && (
                                <div className="mt-4 p-3 bg-gray-50 rounded">
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-medium text-gray-900">Allocation by Method (preview)</h4>
                                    {isAdmin && (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={async () => {
                                            if (!confirm('Clear deposit_allocations for this deposit\'s period and method? This will delete allocation rows for this period and method.')) return;
                                            try {
                                              console.log('🧹 Clearing deposit_allocations for', deposit.id, deposit.start_date, deposit.end_date, deposit.payment_method_id);
                                              const { data, error } = await supabase.rpc('clear_deposit_allocations', {
                                                p_start_date: deposit.start_date,
                                                p_end_date: deposit.end_date,
                                                p_payment_method_id: deposit.payment_method_id || null
                                              });
                                              if (error) throw error;
                                              console.log('🧹 clear_deposit_allocations result:', data);
                                              alert(`Deleted ${data} allocation row(s) for this period/method.`);
                                              // Re-run preview to refresh values (force bypass cache)
                                              await previewAllocation(deposit, true);
                                            } catch (err: any) {
                                              console.error('Failed to clear allocations:', err);
                                              alert('Failed to clear allocations: ' + err.message);
                                            }
                                          }}
                                          className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                                        >
                                          Clear Allocations
                                        </button>
                                        <div className="flex gap-2">
                                          <button
                                            onClick={async () => { await previewAllocation(deposit, true); alert('Preview refreshed'); }}
                                            className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                                          >
                                            Refresh Preview
                                          </button>

                                          <button
                                            onClick={async () => {
                                              if (deposit.status !== 'approved') { alert('Allocations can only be populated for approved deposits'); return; }
                                              if (!confirm('Run allocation population for this deposit now?')) return;
                                              try {
                                                setAllocationRefreshingIds(prev => new Set([...Array.from(prev), deposit.id]));
                                                const { error } = await supabase.rpc('populate_deposit_allocations', { p_deposit_id: deposit.id });
                                                if (error) {
                                                  console.error('Manual populate error:', error);
                                                  alert('Failed to refresh allocations: ' + (error.message || JSON.stringify(error)));
                                                } else {
                                                  setAllocationRefreshTimes(prev => ({ ...prev, [deposit.id]: new Date().toISOString() }));
                                                  alert('Allocations refreshed successfully');
                                                  await loadDeposits();
                                                }
                                              } catch (err: any) {
                                                console.error('Manual populate exception:', err);
                                                alert('Error refreshing allocations: ' + (err.message || String(err)));
                                              } finally {
                                                setAllocationRefreshingIds(prev => {
                                                  const s = new Set(Array.from(prev).filter(x => x !== deposit.id));
                                                  return s;
                                                });
                                              }
                                            }}
                                            className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200"
                                          >
                                            Refresh Allocations
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 gap-2 text-sm">
                                    {allocationPreview[deposit.id]!.per_method!.map((pm) => (
                                      <div key={pm.payment_method_id} className="flex justify-between items-center">
                                        <div className="text-gray-700">
                                          <span className="font-medium">{pm.name || pm.payment_method_id}</span>
                                          <span className="text-xs text-gray-500 ml-2">(Remaining after this: {pm.remaining?.toLocaleString ? pm.remaining.toLocaleString() : 'N/A'} EGP)</span>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-sm text-blue-600">Gap (خلال الفترة): {typeof pm.gap_available === 'number' ? pm.gap_available.toLocaleString() : 'N/A'} EGP</div>
                                          <div className="text-sm text-red-600">Gap Uncovered: {typeof pm.gap_uncovered === 'number' ? pm.gap_uncovered.toLocaleString() : 'N/A'} EGP</div>
                                          <div className="text-sm text-orange-600">Gap Covered: {typeof pm.gap_covered === 'number' ? pm.gap_covered.toLocaleString() : 'N/A'} EGP</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ));
                  })()
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Footer */}
          {filteredDeposits.length > 0 && (
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredDeposits.length)}-{Math.min(currentPage * itemsPerPage, filteredDeposits.length)} of {filteredDeposits.length} deposits
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="p-2 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                  title="Previous page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                
                <div className="px-4 py-2 bg-white border border-gray-300 rounded-lg">
                  <span className="font-medium text-gray-900">{currentPage}</span>
                  <span className="text-gray-600"> / </span>
                  <span className="text-gray-600">{Math.ceil(filteredDeposits.length / itemsPerPage)}</span>
                </div>
                
                <button
                  onClick={() => setCurrentPage(Math.min(Math.ceil(filteredDeposits.length / itemsPerPage), currentPage + 1))}
                  disabled={currentPage >= Math.ceil(filteredDeposits.length / itemsPerPage)}
                  className="p-2 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                  title="Next page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Image Modal */}
      {modalImage && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center">
            <button
              onClick={() => setModalImage(null)}
              className="absolute top-4 right-4 bg-white rounded-full p-2 hover:bg-gray-100 z-10"
            >
              <XCircle className="h-6 w-6 text-gray-700" />
            </button>
            <img
              src={modalImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
      
      {/* Excel Modal */}
      {modalExcel && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setModalExcel(null)}
        >
          <div 
            className="bg-white rounded-lg max-w-7xl max-h-[90vh] w-full overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">{modalExcel.name}</h3>
              <button
                onClick={() => setModalExcel(null)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <XCircle className="h-6 w-6 text-gray-700" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {loadingExcel ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-gray-500">Loading Excel file...</div>
                </div>
              ) : excelData.length > 0 ? (
                <>
                  {selectedCells.size > 0 && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-blue-900">
                          Selected Cells: {selectedCells.size}
                        </span>
                        <span className="text-sm font-semibold text-blue-700">
                          Sum: {cellSum.toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={clearSelection}
                        className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                      >
                        Clear Selection
                      </button>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-gray-300">
                      <tbody>
                        {excelData.map((row, rowIdx) => (
                          <tr key={rowIdx} className={rowIdx === 0 ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'}>
                            {row.map((cell: any, cellIdx: number) => {
                              const cellKey = `${rowIdx}-${cellIdx}`;
                              const isSelected = selectedCells.has(cellKey);
                              const formattedValue = formatExcelValue(cell);
                              
                              return (
                                <td 
                                  key={cellIdx} 
                                  onClick={() => rowIdx > 0 && handleCellClick(rowIdx, cellIdx, cell)}
                                  className={`border border-gray-300 px-3 py-2 text-sm whitespace-nowrap ${
                                    rowIdx > 0 ? 'cursor-pointer hover:bg-blue-50' : ''
                                  } ${isSelected ? 'bg-blue-200 font-semibold' : ''}`}
                                >
                                  {formattedValue}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-gray-500">No data found in Excel file</div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t flex justify-between items-center">
              <div className="text-sm text-gray-600">
                💡 Tip: Click on cells to select them and see the sum
              </div>
              <a
                href={modalExcel.url}
                download={modalExcel.name}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download File
              </a>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import AdminDepositForm from '@/components/deposits/AdminDepositForm';
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
  const [showAdminDepositForm, setShowAdminDepositForm] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
  
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
  
  // Filters - Restored from localStorage
  const [filterStartDate, setFilterStartDate] = useState(savedFilters?.filterStartDate || '');
  const [filterEndDate, setFilterEndDate] = useState(savedFilters?.filterEndDate || '');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>(savedFilters?.filterStatus || 'all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState(savedFilters?.filterPaymentMethod || 'all');
  const [filterUploadedBy, setFilterUploadedBy] = useState(savedFilters?.filterUploadedBy || 'all');
  
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
        proof_files: d.proof_file_url ? JSON.parse(d.proof_file_url) : []
      }));
      
      console.log('✅ Loaded', depositsWithFiles.length, 'deposits. Users:', [...userEmailMap.values()]);
      setDeposits(depositsWithFiles);
      setFilteredDeposits(depositsWithFiles);
    } catch (err: any) {
      console.error('Error loading deposits:', err);
    }
  };

  useEffect(() => {
    applyFilters();
  }, [deposits, filterStartDate, filterEndDate, filterStatus, filterPaymentMethod, filterUploadedBy]);

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
      'User Email',
      'Start Date',
      'End Date',
      'Payment Method',
      'Total Amount (EGP)',
      'Tax Amount (EGP)',
      'Net Amount (EGP)',
      'Gap Uncovered (EGP)',
      'Remaining Amount (EGP)',
      'Status',
      'Notes',
      'Created Date'
    ];

    // Prepare CSV rows
    const rows = filteredDeposits.map(deposit => [
      deposit.user_email || 'Unknown',
      new Date(deposit.start_date).toLocaleDateString(),
      new Date(deposit.end_date).toLocaleDateString(),
      deposit.payment_methods?.name_en || deposit.payment_method_name || 'N/A',
      deposit.total_amount,
      deposit.tax_amount,
      deposit.net_amount,
      deposit.gap_uncovered || '-',
      deposit.remaining_amount || '-',
      deposit.status,
      (deposit.notes || '').replace(/"/g, '""'), // Escape quotes
      new Date(deposit.created_at).toLocaleDateString()
    ]);

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

    try {
      console.log('🗑️ Deleting deposit:', depositId);
      
      // RLS policy handles the permission check
      const { error } = await supabase
        .from('deposits')
        .delete()
        .eq('id', depositId);

      if (error) {
        console.error('❌ Delete error:', error);
        alert('Failed to delete: ' + error.message + '. Only pending deposits can be deleted.');
        return;
      }
      
      console.log('✅ Deposit deleted successfully');
      alert('Deposit deleted successfully!');
      await loadDeposits();
    } catch (err: any) {
      console.error('❌ Delete failed:', err);
      alert('Failed to delete: ' + err.message);
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
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  onClick={() => setShowAdminDepositForm(true)}
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

        {/* Filters */}
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

        {/* New Deposit Form */}
        {showForm && !isAdmin && (
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
                    onChange={(e) => setPaymentMethodId(e.target.value)}
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

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date Range</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Method</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tax</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gap Uncovered</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Remaining</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Files</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDeposits.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
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
                        <td className="px-6 py-4">
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
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 text-xs font-semibold">
                                {deposit.user_email?.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-medium">{deposit.user_email}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {new Date(deposit.start_date).toLocaleDateString()} - {new Date(deposit.end_date).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {deposit.payment_methods?.name_en || deposit.payment_method_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-gray-900">
                          {deposit.total_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-gray-900">
                          {deposit.tax_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-semibold text-blue-600">
                          {deposit.net_amount.toLocaleString()} EGP
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-red-600 font-medium">
                          {deposit.status === 'approved' && deposit.gap_uncovered !== undefined ? 
                            `${deposit.gap_uncovered.toLocaleString()} EGP` : 
                            <span className="text-gray-400">-</span>
                          }
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-orange-600 font-medium">
                          {deposit.status === 'approved' && deposit.remaining_amount !== undefined ? 
                            `${deposit.remaining_amount.toLocaleString()} EGP` : 
                            <span className="text-gray-400">-</span>
                          }
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {deposit.proof_files && deposit.proof_files.length > 0 ? (
                            <span className="text-primary-600 flex items-center gap-1">
                              <File className="h-4 w-4" />
                              {deposit.proof_files.length} file(s)
                            </span>
                          ) : (
                            <span className="text-gray-400">No files</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm">
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
                        <td className="px-6 py-4 text-sm text-right">
                          <div className="flex gap-2 justify-end">
                            {isAdmin && deposit.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(deposit.id)}
                                  className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject(deposit.id)}
                                  className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs"
                                >
                                  Reject
                                </button>
                              </>
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
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      
                      {/* Expanded Row - File Preview */}
                      {expandedRow === deposit.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={12} className="px-6 py-4">
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

      {/* Admin Add Deposit Modal */}
      {showAdminDepositForm && (
        <AdminDepositForm
          onClose={() => setShowAdminDepositForm(false)}
          onSuccess={() => loadDeposits()}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

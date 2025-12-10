'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { Invoice, CreditNote } from '@/types';
import { FileText, CreditCard, Calendar, DollarSign, Filter, Search, Download, ChevronDown, ChevronUp } from 'lucide-react';

type DocumentType = 'all' | 'invoices' | 'credits';

export default function InvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credits, setCredits] = useState<CreditNote[]>([]);
  
  // Filters
  const [documentType, setDocumentType] = useState<DocumentType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
  const [hasCreditsFilter, setHasCreditsFilter] = useState<'all' | 'with_credits' | 'no_credits'>('all');
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  
  // Sort
  const [sortField, setSortField] = useState<'sale_order_date' | 'amount_total'>('sale_order_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100); // Show 100 items per page

  useEffect(() => {
    const init = async () => {
      console.log('📄 [INVOICES] Checking authentication...');
      const { session } = await auth.getSession();
      
      if (!session) {
        console.log('❌ [INVOICES] No session, redirecting to login');
        router.push('/login');
        return;
      }
      
      await Promise.all([
        loadInvoices(),
        loadCredits(),
        loadPaymentMethods()
      ]);
      
      setLoading(false);
    };

    init();
  }, [router]);

  // Cache: Pre-calculate credits per invoice (only recalculate when data changes)
  const invoicesWithCredits = useMemo(() => {
    console.log('🔄 Recalculating credits mapping...');
    
    // Build credits index for O(1) lookup
    const creditsMap = new Map<string, number>();
    credits.forEach(cr => {
      if (cr.original_invoice_id) {
        const current = creditsMap.get(cr.original_invoice_id) || 0;
        creditsMap.set(cr.original_invoice_id, current + cr.amount_total);
      }
    });

    return invoices.map(inv => {
      const totalCredits = creditsMap.get(inv.id) || 0;
      return {
        ...inv,
        type: 'invoice' as const,
        credits_applied: totalCredits,
        net_amount: inv.amount_total - totalCredits,
        has_credits: totalCredits > 0
      };
    });
  }, [invoices, credits]);

  // Cache: Filtered and sorted data
  const filteredData = useMemo(() => {
    console.log('🔍 Applying filters...');
    let data: any[] = [];

    // Filter by document type
    if (documentType === 'all') {
      data = [
        ...invoicesWithCredits,
        ...credits.map(cr => ({ ...cr, type: 'credit', has_credits: false }))
      ];
    } else if (documentType === 'invoices') {
      data = [...invoicesWithCredits];
    } else {
      data = credits.map(cr => ({ ...cr, type: 'credit', has_credits: false }));
    }

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      data = data.filter(item => {
        const number = item.type === 'invoice' ? item.invoice_number : item.credit_note_number;
        const partner = item.partner_name?.toLowerCase() || '';
        return number?.toLowerCase().includes(search) || partner.includes(search);
      });
    }

    // Date range filter
    if (startDate) {
      const start = new Date(startDate).getTime();
      data = data.filter(item => new Date(item.sale_order_date).getTime() >= start);
    }
    if (endDate) {
      const end = new Date(endDate).getTime();
      data = data.filter(item => new Date(item.sale_order_date).getTime() <= end);
    }

    // Payment method filter
    if (selectedPaymentMethod !== 'all') {
      data = data.filter(item => item.payment_method_id === selectedPaymentMethod);
    }

    // Credits filter (only for invoices)
    if (hasCreditsFilter !== 'all' && documentType !== 'credits') {
      if (hasCreditsFilter === 'with_credits') {
        data = data.filter(item => item.type === 'invoice' && item.has_credits === true);
      } else if (hasCreditsFilter === 'no_credits') {
        data = data.filter(item => item.type === 'credit' || (item.type === 'invoice' && item.has_credits === false));
      }
    }

    // Sort
    data.sort((a, b) => {
      let aVal, bVal;
      
      if (sortField === 'sale_order_date') {
        aVal = new Date(a.sale_order_date).getTime();
        bVal = new Date(b.sale_order_date).getTime();
      } else {
        aVal = a.amount_total;
        bVal = b.amount_total;
      }

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    console.log('✅ Filtered data:', data.length, 'items');
    return data;
  }, [invoicesWithCredits, credits, documentType, searchTerm, startDate, endDate, selectedPaymentMethod, hasCreditsFilter, sortField, sortOrder]);

  // Paginated data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredData.slice(startIndex, endIndex);
  }, [filteredData, currentPage, itemsPerPage]);
  
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  
  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [documentType, searchTerm, startDate, endDate, selectedPaymentMethod, hasCreditsFilter]);

  const loadInvoices = async () => {
    try {
      console.log('📥 Loading ALL invoices (fast parallel loading without count)...');
      const startTime = performance.now();
      
      // Load in parallel batches until we get less than BATCH_SIZE (no count query needed)
      const BATCH_SIZE = 1000;
      const PARALLEL_REQUESTS = 5;
      let allInvoices: any[] = [];
      let batchIndex = 0;
      let hasMore = true;
      
      while (hasMore) {
        const promises = [];
        
        // Prepare parallel batch requests
        for (let j = 0; j < PARALLEL_REQUESTS; j++) {
          const offset = (batchIndex + j) * BATCH_SIZE;
          promises.push(
            supabase
              .from('invoices')
              .select(`
                *,
                payment_methods(id, name_en, name_ar, code)
              `)
              .order('sale_order_date', { ascending: false })
              .range(offset, offset + BATCH_SIZE - 1)
          );
        }
        
        const results = await Promise.all(promises);
        let batchHasData = false;
        
        results.forEach(({ data }) => {
          if (data && data.length > 0) {
            allInvoices = allInvoices.concat(data);
            batchHasData = true;
            
            // If any batch returned less than BATCH_SIZE, we're near the end
            if (data.length < BATCH_SIZE) {
              hasMore = false;
            }
          }
        });
        
        // If no batches returned data, we're done
        if (!batchHasData) {
          hasMore = false;
        }
        
        batchIndex += PARALLEL_REQUESTS;
        console.log(`📥 Loaded ${allInvoices.length} invoices...`);
      }
      
      const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
      setInvoices(allInvoices);
      console.log(`✅ Loaded ALL invoices: ${allInvoices.length} in ${loadTime}s`);
    } catch (err: any) {
      console.error('❌ Error loading invoices:', err);
    }
  };

  const loadCredits = async () => {
    try {
      console.log('📥 Loading ALL credits (fast parallel loading)...');
      const startTime = performance.now();
      
      // Step 1: Get total count (using a simple query to avoid 500 error)
      const { count, error: countError } = await supabase
        .from('credit_notes')
        .select('id', { count: 'exact', head: true });
      
      if (countError) {
        console.error('❌ Error getting count:', countError);
        setCredits([]);
        return;
      }
      
      if (!count) {
        setCredits([]);
        return;
      }
      
      console.log(`📊 Total credits: ${count}`);
      
      // Step 2: Load in parallel batches (5 at a time for speed)
      const BATCH_SIZE = 1000;
      const PARALLEL_REQUESTS = 5;
      const totalBatches = Math.ceil(count / BATCH_SIZE);
      let allCredits: any[] = [];
      
      for (let i = 0; i < totalBatches; i += PARALLEL_REQUESTS) {
        const promises = [];
        
        for (let j = 0; j < PARALLEL_REQUESTS && (i + j) < totalBatches; j++) {
          const offset = (i + j) * BATCH_SIZE;
          promises.push(
            supabase
              .from('credit_notes')
              .select(`
                *,
                payment_methods(id, name_en, name_ar, code)
              `)
              .order('sale_order_date', { ascending: false })
              .range(offset, offset + BATCH_SIZE - 1)
          );
        }
        
        const results = await Promise.all(promises);
        results.forEach(({ data }) => {
          if (data) allCredits = allCredits.concat(data);
        });
        
        console.log(`📥 Loaded ${allCredits.length}/${count} credits...`);
      }
      
      const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
      setCredits(allCredits);
      console.log(`✅ Loaded ALL credits: ${allCredits.length} in ${loadTime}s`);
    } catch (err: any) {
      console.error('❌ Error loading credits:', err);
    }
  };

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
    }
  };

  const toggleSort = (field: 'sale_order_date' | 'amount_total') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const exportToCSV = () => {
    // Match the exact table shown in UI
    const headers = [
      'Type',
      'Number',
      'Partner',
      'Sale Order Date',
      'Payment Method',
      'Amount Total',
      'Credits Applied',
      'Net Amount',
      'Status'
    ];
    
    // Use the same filtered data shown in the table
    const dataToExport = filteredData;
    
    const rows = dataToExport.map(item => {
      const isInvoice = item.type === 'invoice';
      const creditsApplied = isInvoice && item.credits_applied ? item.credits_applied : 0;
      const netAmount = isInvoice && item.net_amount ? item.net_amount : item.amount_total;
      
      return [
        isInvoice ? 'Invoice' : 'Credit',
        isInvoice ? item.invoice_number : item.credit_note_number,
        item.partner_name || 'Imported Customer',
        new Date(item.sale_order_date).toLocaleDateString('en-GB'),
        item.payment_methods?.name_en || '-',
        `${item.amount_total.toFixed(2)} EGP`,
        isInvoice ? (creditsApplied > 0 ? `(${creditsApplied.toFixed(2)}) EGP` : '-') : '-',
        `${netAmount.toFixed(2)} EGP`,
        item.state === 'posted' ? 'Posted' : item.state
      ];
    });

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = documentType === 'credits' ? 'Credits' : documentType === 'invoices' ? 'Invoices' : 'Documents';
    a.download = `${fileName}_exported_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const totalInvoices = filteredData.filter(d => d.type === 'invoice').reduce((sum, i) => sum + i.amount_total, 0);
  // Only count credits that are linked to invoices (have original_invoice_id)
  const totalCredits = filteredData.filter(d => d.type === 'credit' && d.original_invoice_id).reduce((sum, c) => sum + c.amount_total, 0);
  const netAmount = totalInvoices - totalCredits;

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
          <h1 className="text-3xl font-bold text-gray-900">Invoices & Credit Notes</h1>
          <p className="text-gray-600 mt-2">View and manage all imported documents</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Invoices</p>
                <p className="text-2xl font-bold text-green-600">
                  {totalInvoices.toLocaleString()} EGP
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {filteredData.filter(d => d.type === 'invoice').length} documents
                </p>
              </div>
              <FileText className="h-12 w-12 text-green-600 opacity-20" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Credits</p>
                <p className="text-2xl font-bold text-red-600">
                  {totalCredits.toLocaleString()} EGP
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {filteredData.filter(d => d.type === 'credit' && d.original_invoice_id).length} documents (linked to invoices)
                </p>
              </div>
              <CreditCard className="h-12 w-12 text-red-600 opacity-20" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Net Amount</p>
                <p className={`text-2xl font-bold ${netAmount >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {netAmount.toLocaleString()} EGP
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {filteredData.length} total documents
                </p>
              </div>
              <DollarSign className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Document Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All Documents</option>
                <option value="invoices">Invoices Only</option>
                <option value="credits">Credits Only</option>
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Number or partner..."
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
              <select
                value={selectedPaymentMethod}
                onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All Methods</option>
                {paymentMethods.map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.name_en}</option>
                ))}
              </select>
            </div>

            {/* Credits Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Credit Status</label>
              <select
                value={hasCreditsFilter}
                onChange={(e) => setHasCreditsFilter(e.target.value as 'all' | 'with_credits' | 'no_credits')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                disabled={documentType === 'credits'}
              >
                <option value="all">All Invoices</option>
                <option value="with_credits">Has Credits</option>
                <option value="no_credits">No Credits</option>
              </select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => {
                setSearchTerm('');
                setStartDate('');
                setEndDate('');
                setSelectedPaymentMethod('all');
                setDocumentType('all');
                setHasCreditsFilter('all');
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Clear Filters
            </button>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Partner</th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('sale_order_date')}
                  >
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      Sale Order Date
                      {sortField === 'sale_order_date' && (
                        sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Method</th>
                  <th 
                    className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('amount_total')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Amount Total
                      {sortField === 'amount_total' && (
                        sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credits Applied</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                      <FileText className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No documents found</p>
                      <p className="text-sm mt-1">Try adjusting your filters</p>
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            item.type === 'invoice' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {item.type === 'invoice' ? 'Invoice' : 'Credit'}
                          </span>
                          {item.type === 'invoice' && item.has_credits && (
                            <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800" title="Has credits applied">
                              🏴 Credits
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {item.type === 'invoice' ? item.invoice_number : item.credit_note_number}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {item.partner_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(item.sale_order_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.payment_methods?.name_en || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                        {item.amount_total.toLocaleString()} EGP
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-red-600">
                        {item.type === 'invoice' && item.credits_applied > 0 ? (
                          `(${item.credits_applied.toLocaleString()}) EGP`
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-600">
                        {item.type === 'invoice' && item.credits_applied > 0 ? (
                          `${item.net_amount.toLocaleString()} EGP`
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          item.state === 'posted' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {item.state}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between items-center sm:hidden">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredData.length)}</span> of{' '}
                    <span className="font-medium">{filteredData.length}</span> results
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    
                    {/* Page numbers */}
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            currentPage === pageNum
                              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Last
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

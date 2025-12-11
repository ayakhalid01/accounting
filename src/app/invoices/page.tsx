'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { Invoice, CreditNote } from '@/types';
import { FileText, CreditCard, Calendar, DollarSign, Filter, Search, Download, ChevronDown, ChevronUp } from 'lucide-react';

type DocumentType = 'all' | 'invoices' | 'credits';

// Statistics interface from database view
interface DashboardStatistics {
  total_invoices_count: number;
  total_invoices_amount: number;
  total_credits_count: number;
  total_credits_amount: number;
  net_amount: number;
  last_updated: string;
}

export default function InvoicesPage() {
  const router = useRouter();
  
  // ============================================
  // State - Only Current Page Data
  // ============================================
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credits, setCredits] = useState<CreditNote[]>([]);
  
  // Statistics from database view (ALL data, instant)
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  
  // Filters
  const [documentType, setDocumentType] = useState<DocumentType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('2025-11-01'); // Default start date
  const [endDate, setEndDate] = useState('2025-12-31'); // Default end date
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
  const [hasCreditsFilter, setHasCreditsFilter] = useState<'all' | 'with_credits' | 'no_credits'>('all');
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  
  // Sort
  const [sortField, setSortField] = useState<'sale_order_date' | 'amount_total'>('sale_order_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(1000); // Load 1000 per page

  // ============================================
  // Load Statistics from Database View (Instant!)
  // ============================================
  const loadStatistics = async () => {
    try {
      console.log('📊 [STATS] Loading from database view...');
      const { data, error } = await supabase.rpc('get_dashboard_statistics');
      
      if (error) {
        console.error('❌ [STATS] Error:', error);
        return;
      }
      
      if (data && data.length > 0) {
        setStatistics(data[0]);
        console.log('✅ [STATS] Loaded:', {
          invoices: data[0].total_invoices_count,
          credits: data[0].total_credits_count,
          net: data[0].net_amount
        });
      }
    } catch (error) {
      console.error('❌ [STATS] Exception:', error);
    }
  };

  // ============================================
  // Load One Page of Invoices (Lazy Loading)
  // ============================================
  const loadInvoices = async (page: number = currentPage) => {
    try {
      console.log(`📥 [INVOICES] Loading page ${page} with date filter: ${startDate} to ${endDate}...`);
      
      const offset = (page - 1) * itemsPerPage;
      
      let query = supabase
        .from('invoices')
        .select('*');
      
      // Apply date range filter
      if (startDate) {
        query = query.gte('sale_order_date', startDate);
      }
      if (endDate) {
        query = query.lte('sale_order_date', endDate);
      }
      
      // Apply payment method filter
      if (selectedPaymentMethod !== 'all') {
        query = query.eq('payment_method_id', selectedPaymentMethod);
      }
      
      const { data, error } = await query
        .order('sale_order_date', { ascending: sortOrder === 'asc' })
        .range(offset, offset + itemsPerPage - 1);

      if (error) throw error;
      
      console.log(`✅ [INVOICES] Loaded ${data?.length || 0} for page ${page}`);
      setInvoices(data || []);
      
    } catch (error) {
      console.error('❌ [INVOICES] Error:', error);
      setInvoices([]);
    }
  };

  // ============================================
  // Load One Page of Credits (Lazy Loading)
  // ============================================
  const loadCredits = async (page: number = currentPage) => {
    try {
      console.log(`📥 [CREDITS] Loading page ${page} with date filter: ${startDate} to ${endDate}...`);
      
      const offset = (page - 1) * itemsPerPage;
      
      let query = supabase
        .from('credit_notes')
        .select('*')
        .not('original_invoice_id', 'is', null);
      
      // Apply date range filter
      if (startDate) {
        query = query.gte('sale_order_date', startDate);
      }
      if (endDate) {
        query = query.lte('sale_order_date', endDate);
      }
      
      // Apply payment method filter
      if (selectedPaymentMethod !== 'all') {
        query = query.eq('payment_method_id', selectedPaymentMethod);
      }
      
      const { data, error } = await query
        .order('credit_date', { ascending: sortOrder === 'asc' })
        .range(offset, offset + itemsPerPage - 1);

      if (error) throw error;
      
      console.log(`✅ [CREDITS] Loaded ${data?.length || 0} for page ${page}`);
      setCredits(data || []);
      
    } catch (error) {
      console.error('❌ [CREDITS] Error:', error);
      setCredits([]);
    }
  };

  // ============================================
  // Load Payment Methods
  // ============================================
  const loadPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_methods_config')
        .select('*')
        .order('method_name');

      if (error) throw error;
      setPaymentMethods(data || []);
    } catch (error) {
      console.error('❌ [PAYMENT_METHODS] Error:', error);
    }
  };

  // ============================================
  // Initial Load - Statistics + First Page
  // ============================================
  useEffect(() => {
    const init = async () => {
      console.log('📄 [INVOICES] Checking authentication...');
      const { session } = await auth.getSession();
      
      if (!session) {
        console.log('❌ [INVOICES] No session, redirecting to login');
        router.push('/login');
        return;
      }
      
      setLoading(true);
      
      // Load statistics and first page in parallel
      await Promise.all([
        loadStatistics(),
        loadInvoices(1),
        loadCredits(1),
        loadPaymentMethods()
      ]);
      
      setLoading(false);
      console.log('✅ [INVOICES] Initial load complete');
    };

    init();
  }, []);

  // ============================================
  // Load New Page When Page Changes
  // ============================================
  useEffect(() => {
    if (currentPage > 1) {
      setLoading(true);
      Promise.all([
        loadInvoices(currentPage),
        loadCredits(currentPage)
      ]).then(() => {
        setLoading(false);
        console.log(`✅ [PAGE] Loaded page ${currentPage}`);
      });
    }
  }, [currentPage]);

  // ============================================
  // Reload When Sort or Filters Change
  // ============================================
  useEffect(() => {
    if (!loading && (invoices.length > 0 || credits.length > 0)) {
      setCurrentPage(1);
      setLoading(true);
      Promise.all([
        loadInvoices(1),
        loadCredits(1)
      ]).then(() => {
        setLoading(false);
        console.log('✅ [FILTERS] Reloaded with new filters');
      });
    }
  }, [sortField, sortOrder, startDate, endDate, selectedPaymentMethod]);

  // ============================================
  // Calculate Credits Applied to Each Invoice
  // ============================================
  const invoicesWithCredits = useMemo(() => {
    console.log('🔄 [CREDITS] Calculating credits per invoice...');
    
    // Build credits index for O(1) lookup
    const creditsMap = new Map<string, number>();
    credits.forEach(cr => {
      if (cr.original_invoice_id) {
        const current = creditsMap.get(cr.original_invoice_id) || 0;
        creditsMap.set(cr.original_invoice_id, current + cr.amount_total);
      }
    });

    return invoices.map(inv => {
      const creditsApplied = creditsMap.get(inv.id) || 0;
      return {
        ...inv,
        credits_applied: creditsApplied,
        net_amount: inv.amount_total - creditsApplied,
        has_credits: creditsApplied > 0
      };
    });
  }, [invoices, credits]);

  // ============================================
  // Combine and Filter Data (Current Page Only)
  // ============================================
  const combinedData = useMemo(() => {
    console.log('🔄 [COMBINE] Combining invoices and credits...');
    
    let data: any[] = [];

    if (documentType === 'all' || documentType === 'invoices') {
      data.push(...invoicesWithCredits.map(inv => ({
        ...inv,
        type: 'invoice' as const,
        date: inv.sale_order_date,
        number: inv.invoice_number,
        amount: inv.amount_total
      })));
    }

    if (documentType === 'all' || documentType === 'credits') {
      data.push(...credits.map(cr => ({
        ...cr,
        type: 'credit' as const,
        date: cr.credit_date,
        number: cr.credit_note_number,
        amount: cr.amount_total,
        invoiceNumber: cr.original_invoice_id ? 
          invoicesWithCredits.find(inv => inv.id === cr.original_invoice_id)?.invoice_number : 
          null
      })));
    }

    console.log('✅ [COMBINE] Combined:', data.length);
    return data;
  }, [invoicesWithCredits, credits, documentType]);

  // ============================================
  // Apply Filters (Client-Side, Current Page Only)
  // ============================================
  const filteredData = useMemo(() => {
    console.log('🔍 [FILTER] Applying filters...');
    
    let filtered = combinedData;

    // Search term
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.number?.toLowerCase().includes(search) ||
        item.customer_name?.toLowerCase().includes(search) ||
        item.invoiceNumber?.toLowerCase().includes(search)
      );
    }

    // Date range
    if (startDate) {
      filtered = filtered.filter(item => new Date(item.date) >= new Date(startDate));
    }
    if (endDate) {
      filtered = filtered.filter(item => new Date(item.date) <= new Date(endDate));
    }

    // Payment method
    if (selectedPaymentMethod !== 'all') {
      filtered = filtered.filter(item => 
        item.payment_method_id?.toString() === selectedPaymentMethod
      );
    }

    // Credits filter
    if (hasCreditsFilter === 'with_credits' && documentType !== 'credits') {
      const invoicesWithCredits = new Set(
        credits.map(cr => cr.original_invoice_id).filter(Boolean)
      );
      filtered = filtered.filter(item => 
        item.type === 'invoice' && invoicesWithCredits.has(item.id)
      );
    } else if (hasCreditsFilter === 'no_credits' && documentType !== 'credits') {
      const invoicesWithCredits = new Set(
        credits.map(cr => cr.original_invoice_id).filter(Boolean)
      );
      filtered = filtered.filter(item => 
        item.type === 'invoice' && !invoicesWithCredits.has(item.id)
      );
    }

    console.log('✅ [FILTER] Filtered:', filtered.length);
    return filtered;
  }, [combinedData, searchTerm, startDate, endDate, selectedPaymentMethod, hasCreditsFilter, credits]);

  // ============================================
  // Calculate Total Pages from Statistics
  // ============================================
  const totalPages = useMemo(() => {
    if (!statistics) return 1;
    
    const totalItems = documentType === 'invoices' ? statistics.total_invoices_count :
                      documentType === 'credits' ? statistics.total_credits_count :
                      statistics.total_invoices_count + statistics.total_credits_count;
    
    return Math.ceil(totalItems / itemsPerPage);
  }, [statistics, documentType, itemsPerPage]);

  // ============================================
  // Refresh Statistics (Manual Refresh Button)
  // ============================================
  const refreshStatistics = async () => {
    try {
      console.log('🔄 [STATS] Refreshing...');
      await supabase.rpc('refresh_dashboard_statistics');
      await loadStatistics();
      console.log('✅ [STATS] Refreshed!');
    } catch (error) {
      console.error('❌ [STATS] Refresh error:', error);
    }
  };

  // ============================================
  // Download ALL Data as CSV (SERVER-SIDE - Much Better!)
  // ============================================
  const downloadAllDataAsCSV = async () => {
    try {
      console.log('📥 [CSV] Generating CSV on server...');
      setLoading(true);

      // Call database function - returns ONE text string with ALL data
      const { data, error } = await supabase.rpc('export_invoices_csv');

      if (error) throw error;

      if (!data) {
        console.error('❌ [CSV] No data returned');
        alert('No data to export');
        setLoading(false);
        return;
      }

      // Data is complete CSV text (not array!)
      const csvContent = data;
      const lineCount = csvContent.split('\n').length - 1; // -1 for header

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `all_invoices_credits_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();

      console.log(`✅ [CSV] Downloaded ${lineCount.toLocaleString()} records (server-generated)`);
      setLoading(false);
    } catch (error) {
      console.error('❌ [CSV] Error:', error);
      alert('Error downloading CSV. Please try again.');
      setLoading(false);
    }
  };

  // ============================================
  // Statistics Cards (From Database View)
  // ============================================
  const statsCards = [
    {
      title: 'Total Invoices',
      value: `EGP ${(statistics?.total_invoices_amount || 0).toLocaleString()}`,
      amount: `Total Quantity: ${statistics?.total_invoices_count.toLocaleString() || '0'}`,
      icon: FileText,
      color: 'text-blue-500'
    },
    {
      title: 'Total Credits',
      value: `EGP ${(statistics?.total_credits_amount || 0).toLocaleString()}`,
      amount: `Total Quantity: ${statistics?.total_credits_count.toLocaleString() || '0'}`,
      icon: CreditCard,
      color: 'text-red-500'
    },
    {
      title: 'Net Amount',
      value: `EGP ${(statistics?.net_amount || 0).toLocaleString()}`,
      amount: `${((statistics?.total_credits_count || 0) / (statistics?.total_invoices_count || 1) * 100).toFixed(1)}% credit rate`,
      icon: DollarSign,
      color: 'text-green-500'
    }
  ];

  // ============================================
  // Render
  // ============================================
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Invoices & Credit Notes</h1>
          <p className="text-gray-600">
            View and manage your documents
            {statistics && (
              <span className="ml-2 text-xs">
                (Updated: {new Date(statistics.last_updated).toLocaleTimeString()})
              </span>
            )}
          </p>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {statsCards.map((stat, index) => (
            <div key={index} className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">{stat.title}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <stat.icon className={`w-8 h-8 ${stat.color}`} />
              </div>
              <p className="text-sm text-gray-500">{stat.amount}</p>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="mb-4 flex gap-3">
          <button
            onClick={refreshStatistics}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            🔄 Refresh Statistics
          </button>
          <button
            onClick={downloadAllDataAsCSV}
            disabled={loading}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Download All Data (CSV)
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {/* Document Type */}
            <div>
              <label className="block text-sm font-medium mb-2">Document Type</label>
              <select
                value={documentType}
                onChange={(e) => {
                  setDocumentType(e.target.value as DocumentType);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              >
                <option value="all">All Documents</option>
                <option value="invoices">Invoices Only</option>
                <option value="credits">Credits Only</option>
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium mb-2">Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by number or customer..."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm font-medium mb-2">Payment Method</label>
              <select
                value={selectedPaymentMethod}
                onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              >
                <option value="all">All Methods</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.method_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              />
            </div>

            {/* Credits Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">Credits Status</label>
              <select
                value={hasCreditsFilter}
                onChange={(e) => setHasCreditsFilter(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
              >
                <option value="all">All Invoices</option>
                <option value="with_credits">With Credits</option>
                <option value="no_credits">No Credits</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Pagination - TOP */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} • {filteredData.length} items on this page
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1 || loading}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loading}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Documents (Page {currentPage} / {totalPages})
              </h2>
              <div className="text-sm text-gray-600">
                Showing {filteredData.length} items on this page
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading page {currentPage}...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Number</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Customer</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Amount Total</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Credits Applied</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Net Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Payment Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredData.map((item, index) => (
                    <tr key={`${item.type}-${item.id}-${index}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            item.type === 'invoice' 
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
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
                      <td className="px-4 py-3 font-mono text-sm">{item.number}</td>
                      <td className="px-4 py-3">{item.customer_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(item.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        EGP {item.amount?.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-red-600">
                        {item.type === 'invoice' && item.credits_applied > 0 ? (
                          `(${item.credits_applied.toLocaleString()}) EGP`
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        {item.type === 'invoice' ? (
                          `EGP ${item.net_amount?.toLocaleString()}`
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {paymentMethods.find(m => m.id === item.payment_method_id)?.method_name || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination - BOTTOM (duplicate for convenience) */}
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} • {filteredData.length} items on this page
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1 || loading}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loading}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

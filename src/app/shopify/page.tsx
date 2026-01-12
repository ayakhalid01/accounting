'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { formatCurrency } from '@/lib/utils';
import { 
  parseShopifyFile, 
  getUniquePaymentGateways, 
  getUniqueOrderSalesChannels,
  groupShopifySales 
} from '@/lib/parsers/shopifyParser';
import {
  insertShopifySalesBatch,
  getShopifySales,
  getPaymentGatewaysFromDB,
  getOrderSalesChannelsFromDB,
  deleteAllShopifySales,
  getShopifySalesStats
} from '@/lib/supabase/shopify';
import { ShopifyImportRow, ShopifySale, ShopifyFilters } from '@/types';
import { Upload, Search, Filter, Trash2, Download, RefreshCw, X } from 'lucide-react';
import { StatCardSkeleton, TableSkeleton } from '@/components/SkeletonLoaders';

// Cache key for sessionStorage
const SHOPIFY_CACHE_KEY = 'shopify_page_state';

interface CachedState {
  filters: ShopifyFilters;
  currentPage: number;
  pageSize: number;
  timestamp: number;
}

// Check if we're in browser
const isBrowser = typeof window !== 'undefined';

// Save state to sessionStorage
function saveStateToCache(state: CachedState) {
  if (!isBrowser) return;
  try {
    sessionStorage.setItem(SHOPIFY_CACHE_KEY, JSON.stringify(state));
  } catch (e) {
    // Silent fail
  }
}

// Load state from sessionStorage
function loadStateFromCache(): CachedState | null {
  if (!isBrowser) return null;
  try {
    const cached = sessionStorage.getItem(SHOPIFY_CACHE_KEY);
    if (cached) {
      const state = JSON.parse(cached) as CachedState;
      // Cache valid for 30 minutes
      if (Date.now() - state.timestamp < 30 * 60 * 1000) {
        return state;
      }
    }
  } catch (e) {
    // Silent fail
  }
  return null;
}

export default function ShopifyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const initializedRef = useRef(false);
  
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ShopifyImportRow[] | null>(null);
  
  // Data state
  const [sales, setSales] = useState<ShopifySale[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [stats, setStats] = useState({
    totalRecords: 0,
    totalGross: 0,
    totalRefunded: 0,
    totalNet: 0
  });
  
  // Filter options
  const [paymentGateways, setPaymentGateways] = useState<string[]>([]);
  const [salesChannels, setSalesChannels] = useState<string[]>([]);
  
  // Filters - initialize from cache or defaults
  const [filters, setFilters] = useState<ShopifyFilters>(() => {
    const cached = loadStateFromCache();
    if (cached) {
      return cached.filters;
    }
    return {
      date_from: '',
      date_to: '',
      payment_gateway: 'all',
      order_sales_channel: 'all',
      search: ''
    };
  });
  
  // Pagination - initialize from cache or defaults
  const [currentPage, setCurrentPage] = useState(() => {
    const cached = loadStateFromCache();
    return cached?.currentPage || 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const cached = loadStateFromCache();
    return cached?.pageSize || 50;
  });
  
  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  // Save state to cache whenever filters or pagination change
  useEffect(() => {
    if (filters.date_from && filters.date_to) {
      saveStateToCache({
        filters,
        currentPage,
        pageSize,
        timestamp: Date.now()
      });
    }
  }, [filters, currentPage, pageSize]);

  // Format date for display (DD/MM/YYYY)
  const formatDateDisplay = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load sales with filters
      const { data, total, error } = await getShopifySales(filters, currentPage, pageSize);
      
      if (error) {
        console.error('Error loading sales:', error);
      } else {
        setSales(data);
        setTotalRecords(total);
      }
      
      // Load stats
      const statsData = await getShopifySalesStats(filters);
      setStats(statsData);
      
      // Load filter options
      const gateways = await getPaymentGatewaysFromDB();
      setPaymentGateways(gateways);
      
      const channels = await getOrderSalesChannelsFromDB();
      setSalesChannels(channels);
      
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [filters, currentPage, pageSize]);

  // Check auth and load initial data
  useEffect(() => {
    const checkAuth = async () => {
      const { session } = await auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      setUserId(session.user.id);
      
      // Only set default date range if no cached filters exist
      if (!initializedRef.current) {
        initializedRef.current = true;
        
        const cached = loadStateFromCache();
        if (!cached || !cached.filters.date_from || !cached.filters.date_to) {
          // Set default date range (current month)
          const now = new Date();
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          
          setFilters(prev => ({
            ...prev,
            date_from: firstDay.toISOString().split('T')[0],
            date_to: lastDay.toISOString().split('T')[0]
          }));
        }
      }
    };
    
    checkAuth();
  }, [router]);

  // Load data when filters or pagination change
  useEffect(() => {
    if (filters.date_from && filters.date_to) {
      loadData();
    }
  }, [loadData, filters.date_from, filters.date_to]);

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    setUploadError(null);
    setUploadSuccess(null);
    
    try {
      const result = await parseShopifyFile(file);
      setPreviewData(result.rows.slice(0, 10)); // Preview first 10 rows
      
      // Get unique values for filters
      const gateways = getUniquePaymentGateways(result.rows);
      const channels = getUniqueOrderSalesChannels(result.rows);
      
      console.log(`📊 Parsed ${result.rows.length} rows`);
      console.log(`💳 Payment gateways:`, gateways);
      console.log(`📺 Sales channels:`, channels);
      
    } catch (err: any) {
      setUploadError(err.message);
      setPreviewData(null);
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile || !userId) return;
    
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    
    try {
      // Parse file
      const result = await parseShopifyFile(selectedFile);
      
      // Group by day, order_name, payment_gateway
      const grouped = groupShopifySales(result.rows);
      const groupedRows = Array.from(grouped.values());
      
      // Insert in batches
      const insertResult = await insertShopifySalesBatch(
        groupedRows,
        userId,
        (processed, total) => {
          setUploadProgress(Math.round((processed / total) * 100));
        }
      );
      
      if (insertResult.success) {
        setUploadSuccess(`Successfully imported ${insertResult.inserted} records (grouped from ${result.rows.length} rows)`);
        setSelectedFile(null);
        setPreviewData(null);
        
        // Reload data
        await loadData();
      } else {
        setUploadError(`Import failed: ${insertResult.errors.join(', ')}`);
      }
      
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Handle delete all
  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL Shopify sales data? This cannot be undone.')) {
      return;
    }
    
    try {
      const result = await deleteAllShopifySales();
      if (result.success) {
        setUploadSuccess(`Deleted ${result.deleted} records`);
        await loadData();
      } else {
        setUploadError(result.error || 'Delete failed');
      }
    } catch (err: any) {
      setUploadError(err.message);
    }
  };

  // Handle filter change
  const handleFilterChange = (key: keyof ShopifyFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Reset to first page
  };

  // Handle search
  const handleSearch = (value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
    setCurrentPage(1);
  };

  // Apply filters
  const handleApplyFilters = () => {
    setCurrentPage(1);
    loadData();
  };

  // Clear preview
  const clearPreview = () => {
    setSelectedFile(null);
    setPreviewData(null);
    setUploadError(null);
    setUploadSuccess(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shopify Sales</h1>
          <p className="text-gray-600 mt-2">Import and manage Shopify Point of Sale transactions</p>
        </div>

        {/* Upload Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Shopify File
          </h3>
          
          <div className="space-y-4">
            {/* File Input */}
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              
              {selectedFile && (
                <button
                  onClick={clearPreview}
                  className="p-2 text-gray-500 hover:text-red-600"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            
            {/* Preview */}
            {previewData && previewData.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <span className="text-sm font-medium text-gray-700">
                    Preview (first 10 rows of {previewData.length}+)
                  </span>
                </div>
                <div className="overflow-x-auto max-h-64">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Day</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Gateway</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Location</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {previewData.map((row, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 whitespace-nowrap">{row.day}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.order_name}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.payment_gateway}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.pos_location_name}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-right">{formatCurrency(row.net_payments)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* Upload Button */}
            {selectedFile && (
              <div className="flex items-center gap-4">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Uploading... {uploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload & Import
                    </>
                  )}
                </button>
                
                {uploading && (
                  <div className="flex-1">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Messages */}
            {uploadError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {uploadError}
              </div>
            )}
            
            {uploadSuccess && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                {uploadSuccess}
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {loading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Total Records</div>
                <div className="text-2xl font-bold text-gray-900">{stats.totalRecords.toLocaleString()}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Gross Payments</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalGross)}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Refunded</div>
                <div className="text-2xl font-bold text-red-600">{formatCurrency(Math.abs(stats.totalRefunded))}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Net Payments</div>
                <div className="text-2xl font-bold text-blue-600">{formatCurrency(stats.totalNet)}</div>
              </div>
            </>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => handleFilterChange('date_from', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => handleFilterChange('date_to', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* Payment Gateway */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Gateway</label>
              <select
                value={filters.payment_gateway}
                onChange={(e) => handleFilterChange('payment_gateway', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Gateways</option>
                {paymentGateways.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            
            {/* Sales Channel */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sales Channel</label>
              <select
                value={filters.order_sales_channel}
                onChange={(e) => handleFilterChange('order_sales_channel', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Channels</option>
                {salesChannels.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search Order</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Order name..."
                  value={filters.search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Apply Filters
            </button>
            
            <button
              onClick={handleDeleteAll}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">
              Sales Data
              <span className="ml-2 text-sm text-gray-500">
                ({totalRecords.toLocaleString()} records)
              </span>
            </h3>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            {loading ? (
              <TableSkeleton rows={10} columns={6} />
            ) : sales.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No sales data found. Upload a Shopify file to get started.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Day</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gateway</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {formatDateDisplay(sale.day)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                        {sale.order_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                          {sale.payment_gateway}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {sale.pos_location_name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {sale.order_sales_channel || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                        <span className={sale.net_payments >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatCurrency(sale.net_payments)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          {/* Pagination */}
          {!loading && totalRecords > 0 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="text-sm text-gray-600">
                Showing {Math.min((currentPage - 1) * pageSize + 1, totalRecords)} - {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
                >
                  Previous
                </button>
                
                <span className="px-4 py-1 bg-white border rounded">
                  {currentPage} / {totalPages}
                </span>
                
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

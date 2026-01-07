'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { getCache, setCache } from '@/lib/cache';
import { 
  DollarSign, 
  CheckCircle,
  Clock,
  AlertTriangle,
  Wallet
} from 'lucide-react';
import { StatCardSkeleton, TableSkeleton, LoadingWrapper } from '@/components/SkeletonLoaders';

interface DashboardStats {
  totalSales: number;
  approvedDepositsAmount: number;
  pendingDepositsAmount: number;
  approvedDepositsCount: number;
  approvedDepositsGroupCount: number; // unique groups (by payment method)
  approvedDepositsGroupAmount: number; // grouped sum by method
  pendingDepositsCount: number;
  actualDepositsAmount: number;
  actualDepositsCount: number;
  gapAmount: number;
  gapAfterPending: number;
}

interface PeriodComparison {
  period: string;
  periodStart: string;
  periodEnd: string;
  sales: number; // invoices net sales (default shown)
  dailySalesAllocations?: number; // sum from deposit_allocations (may be smaller)
  approvedDeposits: number;
  pendingDeposits: number;
  gap: number;
  gapAfterPending: number;
}

type PeriodType = 'daily' | 'monthly' | 'custom';

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // ============================================
  // Load Saved Filters from localStorage
  // ============================================
  const getSavedFilters = () => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('dashboard_filters');
    return saved ? JSON.parse(saved) : null;
  };
  
  const savedFilters = getSavedFilters();
  
  const [stats, setStats] = useState<DashboardStats>({
    totalSales: 0,
    approvedDepositsAmount: 0,
    pendingDepositsAmount: 0,
    approvedDepositsCount: 0,
    approvedDepositsGroupCount: 0,
    approvedDepositsGroupAmount: 0,
    pendingDepositsCount: 0,
    actualDepositsAmount: 0,
    actualDepositsCount: 0,
    gapAmount: 0,
    gapAfterPending: 0,
  });
  
  const [periodComparisons, setPeriodComparisons] = useState<PeriodComparison[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  // Per-method summaries for current filters
  const [methodSummaries, setMethodSummaries] = useState<Array<any>>([]);
  const [loadingMethodSummaries, setLoadingMethodSummaries] = useState(false);
  
  // Filters - Restored from localStorage
  const [periodType, setPeriodType] = useState<PeriodType>(savedFilters?.periodType || 'monthly');
  const [startDate, setStartDate] = useState<string>(savedFilters?.startDate || '');
  const [endDate, setEndDate] = useState<string>(savedFilters?.endDate || '');
  const [selectedMethod, setSelectedMethod] = useState<string>(savedFilters?.selectedMethod || 'all');
  
  // Applied filters (only update on "Apply" button click)
  const [appliedStartDate, setAppliedStartDate] = useState<string>(savedFilters?.startDate || '');
  const [appliedEndDate, setAppliedEndDate] = useState<string>(savedFilters?.endDate || '');
  const [appliedMethod, setAppliedMethod] = useState<string>(savedFilters?.selectedMethod || 'all');
  const [appliedPeriodType, setAppliedPeriodType] = useState<PeriodType>(savedFilters?.periodType || 'monthly');
  
  // Refresh allocations state
  const [refreshingAllocations, setRefreshingAllocations] = useState(false);
  const [allocationStats, setAllocationStats] = useState<any>(null);

  // Filter application loading state
  const [applyingFilters, setApplyingFilters] = useState(false);

  // ============================================
  // Refresh Deposit Allocations
  // ============================================
  const handleRefreshAllocations = async () => {
    setRefreshingAllocations(true);
    try {
      console.log('🔄 Refreshing deposit allocations...');
      
      const { data, error } = await supabase
        .rpc('refresh_all_deposit_allocations');
      
      if (error) {
        console.error('❌ Error refreshing allocations:', error);
        alert('Error refreshing allocations: ' + error.message);
        return;
      }
      
      console.log('✅ Allocations refreshed:', data);
      setAllocationStats(data[0]);
      
      // Show success message
      if (data && data[0]) {
        const stats = data[0];
        alert(`✅ Allocations Refreshed!\n\nDeposits: ${stats.total_deposits_processed}\nDays: ${stats.total_days_allocated}\nGap Covered: ${stats.total_gap_covered}\nGap Uncovered: ${stats.total_gap_uncovered}\nTime: ${stats.processing_time_seconds?.toFixed(2)}s`);
      }
      
      // Reload dashboard data after refresh
      await loadDashboardData();
    } catch (err: any) {
      console.error('❌ Error during refresh:', err);
      alert('Error: ' + err.message);
    } finally {
      setRefreshingAllocations(false);
    }
  };

  // Pagination for comparison table
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Search for comparison table
  const [periodSearchTerm, setPeriodSearchTerm] = useState('');

  // Search for methods table
  const [methodSearchTerm, setMethodSearchTerm] = useState('');

  // Pagination for Methods table
  const [methodPage, setMethodPage] = useState(1);
  const [methodItemsPerPage, setMethodItemsPerPage] = useState(10);

  // Helper to fetch all pages from Supabase (avoids 1000-row limit)
  const fetchAllRecords = async (query: any) => {
    const pageSize = 1000;
    let offset = 0;
    const all: any[] = [];

    while (true) {
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error) {
        console.error('❌ Error fetching paginated records:', error);
        throw error;
      }
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }

    return all;
  };

  // Method summaries helper
  const computeMethodSummaries = (
    invoices: any[] = [],
    credits: any[] = [],
    allocations: any[] = [],
    depositsArr: any[] = []
  ) => {
    setLoadingMethodSummaries(true);
    try {
      const invoiceMap: Record<string, number> = {};
      invoices.forEach((inv: any) => {
        const pm = inv.payment_method_id || 'unknown';
        invoiceMap[pm] = (invoiceMap[pm] || 0) + Number(inv.amount_total || 0);
      });

  /* RPC helper moved to top-level: fetchMethodSummariesFromDb(sDate,eDate,method) */

  // computeMethodSummaries continues...

      const creditsMap: Record<string, number> = {};
      credits.forEach((cr: any) => {
        const pm = cr.payment_method_id || 'unknown';
        creditsMap[pm] = (creditsMap[pm] || 0) + Math.abs(Number(cr.amount_total || 0));
      });

      const allocationsMap: Record<string, number> = {};
      allocations.forEach((a: any) => {
        const pm = a.payment_method_id || 'unknown';
        allocationsMap[pm] = (allocationsMap[pm] || 0) + Number(a.allocated_amount || 0);
      });

      const pendingMap: Record<string, number> = {};
      depositsArr.forEach((d: any) => {
        if (d.status === 'pending') {
          const pm = d.payment_method_id || 'unknown';
          pendingMap[pm] = (pendingMap[pm] || 0) + Number(d.net_amount || 0);
        }
      });

      const keys = new Set<string>([...
        Object.keys(invoiceMap),
        ...Object.keys(creditsMap),
        ...Object.keys(allocationsMap),
        ...Object.keys(pendingMap)
      ]);

      // keep existing behavior if DB RPC is unavailable; consumer will still receive methodSummaries
      // (the RPC approach is preferred for performance and will be used where available)

      const summaries = Array.from(keys).map(k => {
        const method = paymentMethods.find(pm => pm.id === k) || { id: k, name_en: k };
        const invoicesAmt = invoiceMap[k] || 0;
        const creditsAmt = creditsMap[k] || 0;
        const netInvoices = invoicesAmt - (creditsAmt || 0);
        const approvedAlloc = allocationsMap[k] || 0;
        const pendingAmt = pendingMap[k] || 0;
        const gap = netInvoices - approvedAlloc;
        return {
          payment_method_id: k,
          name: method.name_en || method.name || k,
          netInvoices,
          approvedAlloc,
          pendingAmt,
          gap
        };
      }).sort((a,b) => b.netInvoices - a.netInvoices);

      setMethodSummaries(summaries);
      updateCacheWithMethodSummaries(summaries);
    } finally {
      setLoadingMethodSummaries(false);
    }
  };

  // RPC helper to fetch per-method summaries from the DB (fast)
  const fetchMethodSummariesFromDb = async (sDate: string, eDate: string, method: string) => {
    try {
      const { data, error } = await supabase.rpc('get_method_summaries', {
        p_start_date: sDate,
        p_end_date: eDate,
        p_payment_method_id: method === 'all' ? null : method
      });

      if (error) {
        console.error('❌ get_method_summaries RPC error:', error);
        return null;
      }

      return data || [];
    } catch (err) {
      console.error('❌ Exception calling get_method_summaries:', err);
      return null;
    }
  };

  // ============================================
  // Apply Filters (only when user clicks Apply button)
  // ============================================
  const handleApplyFilters = async () => {
    console.log('✅ [DASHBOARD] Applying filters. Current payment method:', selectedMethod);
    
    // Save to localStorage
    const filtersToSave = {
      periodType,
      startDate,
      endDate,
      selectedMethod
    };
    localStorage.setItem('dashboard_filters', JSON.stringify(filtersToSave));
    
    // DON'T clear old data - keep it visible while loading new data
    console.log('🔄 [DASHBOARD] Keeping old data visible while loading...');
    
    // IMPORTANT: Update applied filters with NEW values (not waiting for state update)
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setAppliedMethod(selectedMethod);
    setAppliedPeriodType(periodType);
    setCurrentPage(1); // Reset pagination when filters change
    setMethodPage(1); // Reset method pagination when filters change
    setMethodSearchTerm(''); // Clear method search when filters change
    
    // Load data directly with new filter values (not from state which updates asynchronously)
    setApplyingFilters(true);
    try {
      await loadDashboardDataWithFilters(startDate, endDate, selectedMethod, periodType);
      console.log('✅ [DASHBOARD] Data loaded successfully for payment method:', selectedMethod);
    } finally {
      setApplyingFilters(false);
    }
  };

  // ============================================
  // Download Comparison Table as CSV
  // ============================================
  const downloadComparisonCSV = () => {
    if (periodComparisons.length === 0) {
      alert('No data to download');
      return;
    }

    // Prepare CSV headers
    const headers = ['Period', 'Sales (invoices) (EGP)', 'Sales (allocations) (EGP)', 'Approved Deposits (EGP)', 'Pending Deposits (EGP)', 'Gap (EGP)', 'Status'];

    // Prepare CSV rows
    const rows = periodComparisons.map(period => [
      period.period,
      period.sales,
      period.dailySalesAllocations || 0,
      period.approvedDeposits,
      period.pendingDeposits,
      Math.abs(period.gap),
      period.gap === 0 ? 'Complete' : period.gapAfterPending <= 0 ? 'Pending' : 'Missing'
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
    link.download = `dashboard_comparison_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    console.log('✅ Downloaded', periodComparisons.length, 'periods as CSV');
  };

  // ============================================
  // Save Filters to localStorage (when filters change)
  // ============================================
  useEffect(() => {
    if (startDate && endDate) { // Only save if dates are set
      const filtersToSave = {
        periodType,
        startDate,
        endDate,
        selectedMethod
      };
      localStorage.setItem('dashboard_filters', JSON.stringify(filtersToSave));
    }
  }, [periodType, startDate, endDate, selectedMethod]);

  // ============================================
  // 🔍 LOGGING: Track stats changes
  // ============================================
  useEffect(() => {
    console.log('💜 [STATS CHANGED] Actual Deposits Card Updated:', {
      amount: stats.actualDepositsAmount,
      count: stats.actualDepositsCount,
      formatted: `EGP ${stats.actualDepositsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      allStats: stats
    });
  }, [stats.actualDepositsAmount, stats.actualDepositsCount]);

  useEffect(() => {
    const checkAuthAndLoadData = async () => {
      const { session } = await auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }
      
      // Set default dates ONLY if not already set from localStorage
      if (!startDate || !endDate) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
        const today = new Date(); // Today (current day)
        setStartDate(firstDay.toISOString().split('T')[0]);
        setEndDate(today.toISOString().split('T')[0]);
        console.log('📅 Default date range (current month to today):', firstDay.toISOString().split('T')[0], 'to', today.toISOString().split('T')[0]);
      } else {
        console.log('📅 Loaded saved filters:', startDate, 'to', endDate);
      }
      
      await loadPaymentMethods();
      setLoading(false);
    };

    checkAuthAndLoadData();
  }, [router]);

  // Cache key helper
  const makeDashboardCacheKey = (s: string, e: string, m: string, pt: PeriodType) => `dashboard:${s}:${e}:${m}:${pt}`;

  // Helper to update cache with method summaries
  const updateCacheWithMethodSummaries = (summaries: any[]) => {
    try {
      const cacheKey = makeDashboardCacheKey(appliedStartDate, appliedEndDate, appliedMethod, appliedPeriodType);
      const existingCache = getCache<any>(cacheKey);
      if (existingCache) {
        setCache(cacheKey, {
          ...existingCache,
          methodSummaries: summaries
        });
      }
    } catch (cacheErr) {
      console.warn('Failed to update method summaries in cache', cacheErr);
    }
  };

  useEffect(() => {
    if (appliedStartDate && appliedEndDate) {
      const cacheKey = makeDashboardCacheKey(appliedStartDate, appliedEndDate, appliedMethod, appliedPeriodType);
      const cached = getCache<any>(cacheKey);

      // Check if cached data is valid (not empty/incomplete)
      const isValidCache = cached && cached.stats && 
        (cached.stats.totalSales > 0 || cached.stats.actualDepositsAmount > 0 || cached.stats.approvedDepositsAmount > 0);

      if (isValidCache) {
        console.log('⚡ Using valid cached dashboard data for', cacheKey);
        if (cached.stats) setStats(cached.stats);
        if (cached.periodComparisons) setPeriodComparisons(cached.periodComparisons);
        if (cached.methodSummaries) setMethodSummaries(cached.methodSummaries);
        if (cached.paymentMethods) setPaymentMethods(cached.paymentMethods);
        // Show cached immediately then refresh in background
        setLoading(false);
        loadDashboardData({ background: true }).catch(err => console.error('Background refresh failed', err));
      } else {
        console.log('📡 Cache invalid or missing, loading fresh data for', cacheKey);
        setLoading(true);
        loadDashboardData();
      }
    }
  }, [appliedStartDate, appliedEndDate, appliedMethod, appliedPeriodType]);

  // Reset method table page when filters, results, or page size change
  useEffect(() => {
    setMethodPage(1);
  }, [appliedMethod, methodSummaries.length, methodItemsPerPage]);

  const loadPaymentMethods = async () => {
    try {
      const { data } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('name_en');
      
      setPaymentMethods(data || []);
    } catch (err) {
      console.error('❌ Error loading payment methods:', err);
    }
  };

  // ============================================
  // Load Dashboard Data WITH Custom Filters (for Apply Filters button)
  // ============================================
  const loadDashboardDataWithFilters = async (
    filterStartDate: string,
    filterEndDate: string,
    filterMethod: string,
    filterPeriodType: PeriodType
  ) => {
    try {
      console.log('🔍 Loading data with filters:', { filterStartDate, filterEndDate, filterMethod, filterPeriodType });
      console.log('🔄 [DASHBOARD] Starting data load for payment method:', filterMethod);
      
      // ============================================
      // STEP 0: cache key
      // ============================================
      const cacheKey = makeDashboardCacheKey(filterStartDate, filterEndDate, filterMethod, filterPeriodType);

      // ============================================
      // STEP 1: Get accurate totals from database (bypasses 1000 limit)
      // ============================================
      const { data: aggregations, error: aggError } = await supabase.rpc('get_dashboard_aggregations', {
        p_start_date: filterStartDate,
        p_end_date: filterEndDate,
        p_payment_method_id: filterMethod === 'all' ? null : filterMethod
      });

      if (aggError) {
        console.error('❌ Aggregations error:', aggError);
      }

      console.log('📊 [Database] Total invoices:', aggregations?.[0]?.total_invoices_count || 0, 'Amount:', aggregations?.[0]?.total_invoices_amount || 0);
      console.log('📊 [Database] Total credits:', aggregations?.[0]?.total_credits_count || 0, 'Amount:', aggregations?.[0]?.total_credits_amount || 0);
      console.log('💰 [Database] Net Sales:', aggregations?.[0]?.net_sales || 0);
      console.log('📊 [Database] Total deposits:', aggregations?.[0]?.total_deposits_count || 0, 'Amount:', aggregations?.[0]?.total_deposits_amount || 0);

      // ============================================
      // STEP 2: Load detailed data for period comparisons (still limited to 1000)
      // ============================================
      // Build query filters - Get invoices
      let invoicesQuery = supabase
        .from('invoices')
        .select('amount_total, sale_order_date, payment_method_id')
        .eq('state', 'posted')
        .gte('sale_order_date', filterStartDate)
        .lte('sale_order_date', filterEndDate);

      // Get credits from credit_notes table
      let creditsQuery = supabase
        .from('credit_notes')
        .select('amount_total, sale_order_date, payment_method_id, original_invoice_id')
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null)
        .gte('sale_order_date', filterStartDate)
        .lte('sale_order_date', filterEndDate);

      let depositsQuery = supabase
        .from('deposits')
        .select('net_amount, total_amount, status, start_date, end_date, payment_method_id')
        .or(`and(start_date.lte.${filterEndDate},end_date.gte.${filterStartDate})`);

      // Query for deposit allocations (actual distributed amounts)
      let allocationsQuery = supabase
        .from('deposit_allocations')
        .select('allocated_amount, allocation_date, payment_method_id')
        .gte('allocation_date', filterStartDate)
        .lte('allocation_date', filterEndDate);

      // Filter by payment method if selected
      if (filterMethod !== 'all') {
        invoicesQuery = invoicesQuery.eq('payment_method_id', filterMethod);
        creditsQuery = creditsQuery.eq('payment_method_id', filterMethod);
        depositsQuery = depositsQuery.eq('payment_method_id', filterMethod);
        allocationsQuery = allocationsQuery.eq('payment_method_id', filterMethod);
      }

      // Fetch ALL matching records using paginated queries to avoid the 1000-row limit
      let invoices: any[] = [];
      let credits: any[] = [];
      let deposits: any[] = [];
      let allocations: any[] = [];

      try {
        invoices = await fetchAllRecords(invoicesQuery);
        credits = await fetchAllRecords(creditsQuery);
        deposits = await fetchAllRecords(depositsQuery);
        allocations = await fetchAllRecords(allocationsQuery);
      } catch (err) {
        console.error('❌ Error fetching full dataset for summaries:', err);
      }

      // Try server-side RPC for method summaries (fast, avoids transferring all rows)
      try {
        const methods = await fetchMethodSummariesFromDb(filterStartDate, filterEndDate, filterMethod);
        if (methods && methods.length) {
          const summaries = (methods || []).map((m: any) => ({
            payment_method_id: m.payment_method_id,
            name: m.name || 'Unknown',
            netInvoices: Number(m.net_invoices || 0),
            approvedAlloc: Number(m.approved_alloc || 0),
            pendingAmt: Number(m.pending_amt || 0),
            gap: Number(m.gap || 0)
          }));
          setMethodSummaries(summaries);
          updateCacheWithMethodSummaries(summaries);
        } else {
          // Fallback to client-side computation (if RPC returns no rows)
          computeMethodSummaries(invoices || [], credits || [], allocations || [], deposits || []);
        }
      } catch (err) {
        console.error('❌ get_method_summaries RPC failed, falling back to client:', err);
        computeMethodSummaries(invoices || [], credits || [], allocations || [], deposits || []);
      }

      console.log('📊 [Frontend] Loaded invoices for charts:', invoices?.length || 0);
      console.log('📊 [Frontend] Loaded credits for charts:', credits?.length || 0);
      console.log('📊 [Frontend] Loaded deposits for charts:', deposits?.length || 0);
      console.log('📊 [Frontend] Loaded allocations for charts:', allocations?.length || 0);

      // Use DATABASE totals for stats (accurate)
      const totalInvoices = aggregations?.[0]?.total_invoices_amount || 0;
      const totalCredits = aggregations?.[0]?.total_credits_amount || 0;
      const netSales = aggregations?.[0]?.net_sales || 0;

      // Calculate deposits from database aggregation
      const totalDeposits = aggregations?.[0]?.total_deposits_amount || 0;

      // Use loaded data for deposits breakdown (approved vs pending)
      const approvedDeposits = deposits?.filter(d => d.status === 'approved') || [];
      const pendingDeposits = deposits?.filter(d => d.status === 'pending') || [];
      
      const approvedDepositsAmount = approvedDeposits.reduce((sum, d) => sum + d.net_amount, 0);
      const pendingDepositsAmount = pendingDeposits.reduce((sum, d) => sum + d.net_amount, 0);
      
      // Compute grouped stats from deposit_allocations (allocated_amount grouped by payment_method_id)
      const groupMap: Record<string, number> = {};
      (allocations || []).forEach(a => {
        const pm = a.payment_method_id || 'unknown';
        let amt = 0;
        if (a && a.allocated_amount != null) {
          const n = Number(a.allocated_amount);
          amt = Number.isFinite(n) ? n : 0;
        }
        groupMap[pm] = (groupMap[pm] || 0) + amt;
      });
      const approvedDepositsGroupCount = Object.keys(groupMap).length;
      const approvedDepositsGroupAmount = Object.values(groupMap).reduce((s, n) => s + n, 0);

      // Actual deposits = sum of allocated_amount from deposit allocations table
      const actualDepositsAmount = allocations?.reduce((sum, a) => sum + a.allocated_amount, 0) || 0;
      const actualDepositsCount = allocations?.length || 0;
      
      // 🔍 LOGGING: Track actual deposits calculation
      console.log('💜 [ACTUAL DEPOSITS - FROM FILTERS] Allocations Raw Data:', allocations);
      console.log('💜 [ACTUAL DEPOSITS - FROM FILTERS] Calculation Details:', {
        totalRecords: allocations?.length || 0,
        totalAllocatedAmount: actualDepositsAmount,
        dateRange: { start: filterStartDate, end: filterEndDate },
        paymentMethod: filterMethod,
        formatted: `EGP ${actualDepositsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      });
      
      const gapAmount = netSales - actualDepositsAmount;
      const gapAfterPending = netSales - actualDepositsAmount - pendingDepositsAmount;

      setStats({
        totalSales: netSales,  // Use database total
        approvedDepositsAmount,
        pendingDepositsAmount,
        approvedDepositsCount: approvedDeposits.length,
        approvedDepositsGroupCount,
        approvedDepositsGroupAmount,
        pendingDepositsCount: pendingDeposits.length,
        actualDepositsAmount,
        actualDepositsCount,
        gapAmount,
        gapAfterPending,
      });
      
      // 🔍 LOGGING: Confirm stats updated
      console.log('✅ [ACTUAL DEPOSITS] Stats Updated:', {
        actualDepositsAmount,
        actualDepositsCount
      });

      // ============================================
      // STEP 3: Load period comparisons from database (accurate for all data)
      // ============================================
      if (filterPeriodType === 'daily') {
        // Use daily aggregations for day-by-day view
        const { data: dailyData, error: dailyError } = await supabase.rpc('get_daily_aggregations', {
          p_start_date: filterStartDate,
          p_end_date: filterEndDate,
          p_payment_method_id: filterMethod === 'all' ? null : filterMethod
        });

        if (dailyError) {
          console.error('❌ Daily aggregations error:', dailyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisonsWithFilters(invoices || [], credits || [], deposits || [], filterStartDate, filterEndDate, filterPeriodType);
        } else {
          console.log('📊 [Database] Daily periods:', dailyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (dailyData || []).map((day: any) => ({
            period: new Date(day.allocation_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
            periodStart: day.allocation_date,
            periodEnd: day.allocation_date,
            sales: Number(day.daily_sales_invoices || 0),
            dailySalesAllocations: Number(day.daily_sales_allocations || 0),
            approvedDeposits: Number(day.approved_deposits || 0),
            pendingDeposits: Number(day.pending_deposits || 0),
            gap: Number(day.daily_gap || 0),
            gapAfterPending: Number((day.daily_sales_invoices || 0) - (day.approved_deposits || 0)),
          }));
          
          setPeriodComparisons(periods);

          // Save to cache
          try {
            setCache(cacheKey, {
              stats: {
                totalSales: netSales,
                approvedDepositsAmount,
                pendingDepositsAmount,
                approvedDepositsCount: approvedDeposits.length,
                approvedDepositsGroupCount,
                approvedDepositsGroupAmount,
                pendingDepositsCount: pendingDeposits.length,
                actualDepositsAmount,
                actualDepositsCount,
                gapAmount,
                gapAfterPending,
              },
              periodComparisons: periods,
              methodSummaries: methodSummaries,
              paymentMethods
            });
          } catch (err) {
            console.warn('Failed to set dashboard cache', err);
          }
        }
      } else if (filterPeriodType === 'monthly') {
        // Use monthly aggregations (grouped from daily data)
        const { data: monthlyData, error: monthlyError } = await supabase.rpc('get_monthly_aggregations', {
          p_start_date: filterStartDate,
          p_end_date: filterEndDate,
          p_payment_method_id: filterMethod === 'all' ? null : filterMethod
        });

        if (monthlyError) {
          console.error('❌ Monthly aggregations error:', monthlyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisonsWithFilters(invoices || [], credits || [], deposits || [], filterStartDate, filterEndDate, filterPeriodType);
        } else {
          console.log('📊 [Database] Monthly periods:', monthlyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (monthlyData || []).map((month: any) => {
            const periodStart = month.period_start || month.month_start;
            const periodEnd = month.period_end || month.month_end;
            const periodLabel = month.period_month || (periodStart ? new Date(periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Invalid Date');
            const sales = Number(month.net_sales ?? month.total_sales ?? 0);
            const approved = Number(month.approved_deposits ?? month.approved ?? 0);
            const pending = Number(month.pending_deposits ?? month.pending ?? 0);
            return {
              period: periodLabel,
              periodStart,
              periodEnd,
              sales,
              approvedDeposits: approved,
              pendingDeposits: pending,
              gap: Number(sales - approved),
              gapAfterPending: Number(sales - approved - pending),
            };
          });
          
          setPeriodComparisons(periods);

          // Save to cache
          try {
            setCache(cacheKey, {
              stats: {
                totalSales: netSales,
                approvedDepositsAmount,
                pendingDepositsAmount,
                approvedDepositsCount: approvedDeposits.length,
                approvedDepositsGroupCount,
                approvedDepositsGroupAmount,
                pendingDepositsCount: pendingDeposits.length,
                actualDepositsAmount,
                actualDepositsCount,
                gapAmount,
                gapAfterPending,
              },
              periodComparisons: periods,
              methodSummaries: methodSummaries,
              paymentMethods
            });
          } catch (err) {
            console.warn('Failed to set dashboard cache', err);
          }
        }
      } else {
        // Use monthly aggregations
        const { data: monthlyData, error: monthlyError } = await supabase.rpc('get_monthly_aggregations', {
          p_start_date: filterStartDate,
          p_end_date: filterEndDate,
          p_payment_method_id: filterMethod === 'all' ? null : filterMethod
        });

        if (monthlyError) {
          console.error('❌ Monthly aggregations error:', monthlyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisonsWithFilters(invoices || [], credits || [], deposits || [], filterStartDate, filterEndDate, filterPeriodType);
        } else {
          console.log('📊 [Database] Monthly periods:', monthlyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (monthlyData || []).map((month: any) => ({
            period: month.period_month,
            periodStart: month.period_start,
            periodEnd: month.period_end,
            sales: month.net_sales,
            approvedDeposits: month.approved_deposits,
            pendingDeposits: month.pending_deposits,
            gap: month.net_sales - month.approved_deposits,
            gapAfterPending: month.net_sales - month.approved_deposits - month.pending_deposits,
          }));
          
          setPeriodComparisons(periods);
        }
      }
    } catch (err) {
      console.error('❌ Error loading dashboard data:', err);
    }
  };

  const loadDashboardData = async (opts?: { background?: boolean }) => {
    // opts.background === true means don't toggle the full loading UI (used for background refresh)
    if (!opts?.background) setLoading(true);
    // ...existing code...
    try {
      console.log('🔍 Loading data with filters:', { appliedStartDate, appliedEndDate, appliedMethod, appliedPeriodType });
      console.log('🔄 [DASHBOARD] Starting data load for payment method:', appliedMethod);
      const cacheKey = makeDashboardCacheKey(appliedStartDate, appliedEndDate, appliedMethod, appliedPeriodType);
      
      // ============================================
      // STEP 1: Get accurate totals from database (bypasses 1000 limit)
      // ============================================
      const { data: aggregations, error: aggError } = await supabase.rpc('get_dashboard_aggregations', {
        p_start_date: appliedStartDate,
        p_end_date: appliedEndDate,
        p_payment_method_id: appliedMethod === 'all' ? null : appliedMethod
      });

      if (aggError) {
        console.error('❌ Aggregations error:', aggError);
      }

      console.log('📊 [Database] Total invoices:', aggregations?.[0]?.total_invoices_count || 0, 'Amount:', aggregations?.[0]?.total_invoices_amount || 0);
      console.log('📊 [Database] Total credits:', aggregations?.[0]?.total_credits_count || 0, 'Amount:', aggregations?.[0]?.total_credits_amount || 0);
      console.log('💰 [Database] Net Sales:', aggregations?.[0]?.net_sales || 0);
      console.log('📊 [Database] Total deposits:', aggregations?.[0]?.total_deposits_count || 0, 'Amount:', aggregations?.[0]?.total_deposits_amount || 0);

      // ============================================
      // STEP 2: Load detailed data for period comparisons (still limited to 1000)
      // ============================================
      // Build query filters - Get invoices
      let invoicesQuery = supabase
        .from('invoices')
        .select('amount_total, sale_order_date, payment_method_id')
        .eq('state', 'posted')
        .gte('sale_order_date', appliedStartDate)
        .lte('sale_order_date', appliedEndDate);

      // Get credits from credit_notes table
      let creditsQuery = supabase
        .from('credit_notes')
        .select('amount_total, sale_order_date, payment_method_id, original_invoice_id')
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null)
        .gte('sale_order_date', appliedStartDate)
        .lte('sale_order_date', appliedEndDate);

      let depositsQuery = supabase
        .from('deposits')
        .select('net_amount, total_amount, status, start_date, end_date, payment_method_id')
        .or(`and(start_date.lte.${appliedEndDate},end_date.gte.${appliedStartDate})`);

      // Query for deposit allocations (actual distributed amounts)
      let allocationsQuery = supabase
        .from('deposit_allocations')
        .select('allocated_amount, allocation_date, payment_method_id')
        .gte('allocation_date', appliedStartDate)
        .lte('allocation_date', appliedEndDate);

      // Filter by payment method if selected
      if (appliedMethod !== 'all') {
        invoicesQuery = invoicesQuery.eq('payment_method_id', appliedMethod);
        creditsQuery = creditsQuery.eq('payment_method_id', appliedMethod);
        depositsQuery = depositsQuery.eq('payment_method_id', appliedMethod);
        allocationsQuery = allocationsQuery.eq('payment_method_id', appliedMethod);
      }

      // Fetch ALL matching records using paginated queries to avoid the 1000-row limit
      let invoices: any[] = [];
      let credits: any[] = [];
      let deposits: any[] = [];
      let allocations: any[] = [];

      try {
        invoices = await fetchAllRecords(invoicesQuery);
        credits = await fetchAllRecords(creditsQuery);
        deposits = await fetchAllRecords(depositsQuery);
        allocations = await fetchAllRecords(allocationsQuery);
      } catch (err) {
        console.error('❌ Error fetching full dataset for summaries:', err);
      }

      // Try server-side RPC for method summaries (fast, avoids transferring all rows)
      try {
        const methods = await fetchMethodSummariesFromDb(appliedStartDate, appliedEndDate, appliedMethod);
        if (methods && methods.length) {
          const summaries = (methods || []).map((m: any) => ({
            payment_method_id: m.payment_method_id,
            name: m.name || 'Unknown',
            netInvoices: Number(m.net_invoices || 0),
            approvedAlloc: Number(m.approved_alloc || 0),
            pendingAmt: Number(m.pending_amt || 0),
            gap: Number(m.gap || 0)
          }));
          setMethodSummaries(summaries);
          
          // Update cache with new method summaries
          updateCacheWithMethodSummaries(summaries);
        } else {
          // Fallback to client-side computation (if RPC returns no rows)
          computeMethodSummaries(invoices || [], credits || [], allocations || [], deposits || []);
        }
      } catch (err) {
        console.error('❌ get_method_summaries RPC failed, falling back to client:', err);
        computeMethodSummaries(invoices || [], credits || [], allocations || [], deposits || []);
      }

      if (invoices && invoices.length >= 1000) console.log('⚠️ Fetched >=1000 invoices (paginated)');
      if (credits && credits.length >= 1000) console.log('⚠️ Fetched >=1000 credits (paginated)');
      if (allocations && allocations.length >= 1000) console.log('⚠️ Fetched >=1000 allocations (paginated)');

      console.log('📊 [Frontend] Loaded invoices for charts:', invoices?.length || 0);
      console.log('📊 [Frontend] Loaded credits for charts:', credits?.length || 0);
      console.log('📊 [Frontend] Loaded deposits for charts:', deposits?.length || 0);
      console.log('📊 [Frontend] Loaded allocations for charts:', allocations?.length || 0);

      // Use DATABASE totals for stats (accurate)
      const totalInvoices = aggregations?.[0]?.total_invoices_amount || 0;
      const totalCredits = aggregations?.[0]?.total_credits_amount || 0;
      const netSales = aggregations?.[0]?.net_sales || 0;

      // Calculate deposits from database aggregation
      const totalDeposits = aggregations?.[0]?.total_deposits_amount || 0;

      // Use loaded data for deposits breakdown (approved vs pending)
      const approvedDeposits = deposits?.filter(d => d.status === 'approved') || [];
      const pendingDeposits = deposits?.filter(d => d.status === 'pending') || [];
      
      const approvedDepositsAmount = approvedDeposits.reduce((sum, d) => sum + d.net_amount, 0);
      const pendingDepositsAmount = pendingDeposits.reduce((sum, d) => sum + d.net_amount, 0);
      
      // Actual deposits = sum of allocated_amount from deposit allocations table
      const actualDepositsAmount = allocations?.reduce((sum, a) => sum + a.allocated_amount, 0) || 0;
      const actualDepositsCount = allocations?.length || 0;
      
      // 🔍 LOGGING: Track actual deposits calculation
      console.log('💜 [ACTUAL DEPOSITS - FROM APP] Allocations Raw Data:', allocations);
      console.log('💜 [ACTUAL DEPOSITS - FROM APP] Calculation Details:', {
        totalRecords: allocations?.length || 0,
        totalAllocatedAmount: actualDepositsAmount,
        dateRange: { start: appliedStartDate, end: appliedEndDate },
        paymentMethod: appliedMethod,
        formatted: `EGP ${actualDepositsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      });
      
      const gapAmount = netSales - actualDepositsAmount;
      const gapAfterPending = netSales - actualDepositsAmount - pendingDepositsAmount;

      // Compute grouped stats from deposit_allocations for main loader as well
      const groupMapMain: Record<string, number> = {};
      (allocations || []).forEach(a => {
        const pm = a.payment_method_id || 'unknown';
        const n = a && a.allocated_amount != null ? Number(a.allocated_amount) : 0;
        const amt = Number.isFinite(n) ? n : 0;
        groupMapMain[pm] = (groupMapMain[pm] || 0) + amt;
      });
      const approvedDepositsGroupCountMain = Object.keys(groupMapMain).length;
      const approvedDepositsGroupAmountMain = Object.values(groupMapMain).reduce((s, n) => s + n, 0);

      setStats({
        totalSales: netSales,  // Use database total
        approvedDepositsAmount,
        pendingDepositsAmount,
        approvedDepositsCount: approvedDeposits.length,
        approvedDepositsGroupCount: approvedDepositsGroupCountMain,
        approvedDepositsGroupAmount: approvedDepositsGroupAmountMain,
        pendingDepositsCount: pendingDeposits.length,
        actualDepositsAmount,
        actualDepositsCount,
        gapAmount,
        gapAfterPending,
      });
      
      // 🔍 LOGGING: Confirm stats updated
      console.log('✅ [ACTUAL DEPOSITS] Stats Updated:', {
        actualDepositsAmount,
        actualDepositsCount
      });

      // ============================================
      // STEP 3: Load period comparisons from database (accurate for all data)
      // ============================================
      if (appliedPeriodType === 'daily') {
        // Use daily aggregations for day-by-day view
        const { data: dailyData, error: dailyError } = await supabase.rpc('get_daily_aggregations', {
          p_start_date: appliedStartDate,
          p_end_date: appliedEndDate,
          p_payment_method_id: appliedMethod === 'all' ? null : appliedMethod
        });

        if (dailyError) {
          console.error('❌ Daily aggregations error:', dailyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisons(invoices || [], credits || [], deposits || []);
        } else {
          console.log('📊 [Database] Daily periods:', dailyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (dailyData || []).map((day: any) => ({
            period: new Date(day.allocation_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
            periodStart: day.allocation_date,
            periodEnd: day.allocation_date,
            sales: Number(day.daily_sales_invoices || 0),
            dailySalesAllocations: Number(day.daily_sales_allocations || 0),
            approvedDeposits: Number(day.approved_deposits || 0),
            pendingDeposits: Number(day.pending_deposits || 0),
            gap: Number(day.daily_gap || 0),
            gapAfterPending: Number((day.daily_sales_invoices || 0) - (day.approved_deposits || 0)),
          }));
          
          setPeriodComparisons(periods);

        // Save to cache
        try {
          setCache(cacheKey, {
            stats: {
              totalSales: netSales,
              approvedDepositsAmount,
              pendingDepositsAmount,
              approvedDepositsCount: approvedDeposits.length,
              approvedDepositsGroupCount: approvedDepositsGroupCountMain,
              approvedDepositsGroupAmount: approvedDepositsGroupAmountMain,
              pendingDepositsCount: pendingDeposits.length,
              actualDepositsAmount,
              actualDepositsCount,
              gapAmount,
              gapAfterPending,
            },
            periodComparisons: periods,
            methodSummaries: methodSummaries,
            paymentMethods
          });
        } catch (err) {
          console.warn('Failed to set dashboard cache', err);
        }
        }
      } else if (appliedPeriodType === 'monthly') {
        // Use monthly aggregations (grouped from daily data)
        const { data: monthlyData, error: monthlyError } = await supabase.rpc('get_monthly_aggregations', {
          p_start_date: appliedStartDate,
          p_end_date: appliedEndDate,
          p_payment_method_id: appliedMethod === 'all' ? null : appliedMethod
        });

        if (monthlyError) {
          console.error('❌ Monthly aggregations error:', monthlyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisons(invoices || [], credits || [], deposits || []);
        } else {
          console.log('📊 [Database] Monthly periods:', monthlyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (monthlyData || []).map((month: any) => {
            const periodStart = month.period_start || month.month_start;
            const periodEnd = month.period_end || month.month_end;
            const periodLabel = month.period_month || (periodStart ? new Date(periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Invalid Date');
            const sales = Number(month.net_sales ?? month.total_sales ?? 0);
            const approved = Number(month.approved_deposits ?? month.approved ?? 0);
            const pending = Number(month.pending_deposits ?? month.pending ?? 0);
            return {
              period: periodLabel,
              periodStart,
              periodEnd,
              sales,
              approvedDeposits: approved,
              pendingDeposits: pending,
              gap: Number(sales - approved),
              gapAfterPending: Number(sales - approved - pending),
            };
          });
          
          setPeriodComparisons(periods);

          // Save to cache
          try {
            setCache(cacheKey, {
              stats: {
                totalSales: netSales,
                approvedDepositsAmount,
                pendingDepositsAmount,
                approvedDepositsCount: approvedDeposits.length,
                approvedDepositsGroupCount: approvedDepositsGroupCountMain,
                approvedDepositsGroupAmount: approvedDepositsGroupAmountMain,
                pendingDepositsCount: pendingDeposits.length,
                actualDepositsAmount,
                actualDepositsCount,
                gapAmount,
                gapAfterPending,
              },
              periodComparisons: periods,
              methodSummaries: methodSummaries,
              paymentMethods
            });
          } catch (err) {
            console.warn('Failed to set dashboard cache', err);
          }
        }
      } else {
        // Use monthly aggregations
        const { data: monthlyData, error: monthlyError } = await supabase.rpc('get_monthly_aggregations', {
          p_start_date: appliedStartDate,
          p_end_date: appliedEndDate,
          p_payment_method_id: appliedMethod === 'all' ? null : appliedMethod
        });

        if (monthlyError) {
          console.error('❌ Monthly aggregations error:', monthlyError);
          // Fallback to frontend calculation (limited data)
          calculatePeriodComparisons(invoices || [], credits || [], deposits || []);
        } else {
          console.log('📊 [Database] Monthly periods:', monthlyData?.length || 0);
          
          // Convert database results to PeriodComparison format
          const periods: PeriodComparison[] = (monthlyData || []).map((month: any) => ({
            period: month.period_month,
            periodStart: month.period_start,
            periodEnd: month.period_end,
            sales: month.net_sales,
            approvedDeposits: month.approved_deposits,
            pendingDeposits: month.pending_deposits,
            gap: month.net_sales - month.approved_deposits,
            gapAfterPending: month.net_sales - month.approved_deposits - month.pending_deposits,
          }));
          
          setPeriodComparisons(periods);

          // Save to cache
          try {
            setCache(cacheKey, {
              stats: {
                totalSales: netSales,
                approvedDepositsAmount,
                pendingDepositsAmount,
                approvedDepositsCount: approvedDeposits.length,
                approvedDepositsGroupCount: approvedDepositsGroupCountMain,
                approvedDepositsGroupAmount: approvedDepositsGroupAmountMain,
                pendingDepositsCount: pendingDeposits.length,
                actualDepositsAmount,
                actualDepositsCount,
                gapAmount,
                gapAfterPending,
              },
              periodComparisons: periods,
              methodSummaries: methodSummaries,
              paymentMethods
            });
          } catch (err) {
            console.warn('Failed to set dashboard cache', err);
          }
        }
      }
    } catch (err) {
      console.error('❌ Error loading dashboard data:', err);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  };

  const calculatePeriodComparisonsWithFilters = (
    invoices: any[],
    credits: any[],
    deposits: any[],
    filterStartDate: string,
    filterEndDate: string,
    filterPeriodType: PeriodType
  ) => {
    const periods: PeriodComparison[] = [];
    const start = new Date(filterStartDate);
    const end = new Date(filterEndDate);

    if (filterPeriodType === 'monthly') {
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      
      while (current <= endMonth) {
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        
        const monthInvoices = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate >= monthStart && invDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);
        
        const monthCredits = credits
          .filter(cr => {
            const crDate = new Date(cr.sale_order_date);
            return crDate >= monthStart && crDate <= monthEnd;
          })
          .reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
        
        const monthSales = monthInvoices - monthCredits;

        const monthDeposits = deposits.filter(d => {
          const depStart = new Date(d.start_date);
          const depEnd = new Date(d.end_date);
          return depStart <= monthEnd && depEnd >= monthStart;
        });

        const approved = monthDeposits
          .filter(d => d.status === 'approved')
          .reduce((sum, d) => sum + d.net_amount, 0);
        
        const pending = monthDeposits
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + d.net_amount, 0);

        periods.push({
          period: monthStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
          periodStart: monthStart.toISOString().split('T')[0],
          periodEnd: monthEnd.toISOString().split('T')[0],
          sales: monthSales,
          approvedDeposits: approved,
          pendingDeposits: pending,
          gap: monthSales - approved,
          gapAfterPending: monthSales - approved - pending,
        });

        current.setMonth(current.getMonth() + 1);
      }
    } else if (filterPeriodType === 'daily') {
      const current = new Date(start);
      
      while (current <= end) {
        const dayStart = new Date(current);
        const dayEnd = new Date(current);
        dayEnd.setHours(23, 59, 59, 999);
        
        const dayInvoices = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate.toDateString() === current.toDateString();
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);
        
        const dayCredits = credits
          .filter(cr => {
            const crDate = new Date(cr.sale_order_date);
            return crDate.toDateString() === current.toDateString();
          })
          .reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
        
        const daySales = dayInvoices - dayCredits;

        const dayDeposits = deposits.filter(d => {
          const depStart = new Date(d.start_date);
          const depEnd = new Date(d.end_date);
          return depStart <= dayEnd && depEnd >= dayStart;
        });

        const approved = dayDeposits
          .filter(d => d.status === 'approved')
          .reduce((sum, d) => sum + d.net_amount, 0);
        
        const pending = dayDeposits
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + d.net_amount, 0);

        if (daySales > 0 || approved > 0 || pending > 0) {
          periods.push({
            period: current.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
            periodStart: current.toISOString().split('T')[0],
            periodEnd: current.toISOString().split('T')[0],
            sales: daySales,
            approvedDeposits: approved,
            pendingDeposits: pending,
            gap: daySales - approved,
            gapAfterPending: daySales - approved - pending,
          });
        }

        current.setDate(current.getDate() + 1);
      }
    } else {
      const totalInvoices = invoices.reduce((sum, inv) => sum + inv.amount_total, 0);
      const totalCredits = credits.reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
      const totalSales = totalInvoices - totalCredits;
      
      const approved = deposits
        .filter(d => d.status === 'approved')
        .reduce((sum, d) => sum + d.net_amount, 0);
      
      const pending = deposits
        .filter(d => d.status === 'pending')
        .reduce((sum, d) => sum + d.net_amount, 0);

      periods.push({
        period: 'Custom Period',
        periodStart: filterStartDate,
        periodEnd: filterEndDate,
        sales: totalSales,
        approvedDeposits: approved,
        pendingDeposits: pending,
        gap: totalSales - approved,
        gapAfterPending: totalSales - approved - pending,
      });
    }

    setPeriodComparisons(periods);
  };

  const calculatePeriodComparisons = (invoices: any[], credits: any[], deposits: any[]) => {
    const periods: PeriodComparison[] = [];
    const start = new Date(appliedStartDate);
    const end = new Date(appliedEndDate);

    if (appliedPeriodType === 'monthly') {
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      
      while (current <= endMonth) {
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        
        const monthInvoices = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate >= monthStart && invDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);
        
        const monthCredits = credits
          .filter(cr => {
            const crDate = new Date(cr.sale_order_date);
            return crDate >= monthStart && crDate <= monthEnd;
          })
          .reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
        
        const monthSales = monthInvoices - monthCredits;

        const monthDeposits = deposits.filter(d => {
          const depStart = new Date(d.start_date);
          const depEnd = new Date(d.end_date);
          return depStart <= monthEnd && depEnd >= monthStart;
        });

        const approved = monthDeposits
          .filter(d => d.status === 'approved')
          .reduce((sum, d) => sum + d.net_amount, 0);
        
        const pending = monthDeposits
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + d.net_amount, 0);

        periods.push({
          period: monthStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
          periodStart: monthStart.toISOString().split('T')[0],
          periodEnd: monthEnd.toISOString().split('T')[0],
          sales: monthSales,
          approvedDeposits: approved,
          pendingDeposits: pending,
          gap: monthSales - approved,
          gapAfterPending: monthSales - approved - pending,
        });

        current.setMonth(current.getMonth() + 1);
      }
    } else if (appliedPeriodType === 'daily') {
      const current = new Date(start);
      
      while (current <= end) {
        const dayStart = new Date(current);
        const dayEnd = new Date(current);
        dayEnd.setHours(23, 59, 59, 999);
        
        const dayInvoices = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate.toDateString() === current.toDateString();
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);
        
        const dayCredits = credits
          .filter(cr => {
            const crDate = new Date(cr.sale_order_date);
            return crDate.toDateString() === current.toDateString();
          })
          .reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
        
        const daySales = dayInvoices - dayCredits;

        const dayDeposits = deposits.filter(d => {
          const depStart = new Date(d.start_date);
          const depEnd = new Date(d.end_date);
          return depStart <= dayEnd && depEnd >= dayStart;
        });

        const approved = dayDeposits
          .filter(d => d.status === 'approved')
          .reduce((sum, d) => sum + d.net_amount, 0);
        
        const pending = dayDeposits
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + d.net_amount, 0);

        if (daySales > 0 || approved > 0 || pending > 0) {
          periods.push({
            period: current.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
            periodStart: current.toISOString().split('T')[0],
            periodEnd: current.toISOString().split('T')[0],
            sales: daySales,
            approvedDeposits: approved,
            pendingDeposits: pending,
            gap: daySales - approved,
            gapAfterPending: daySales - approved - pending,
          });
        }

        current.setDate(current.getDate() + 1);
      }
    } else {
      const totalInvoices = invoices.reduce((sum, inv) => sum + inv.amount_total, 0);
      const totalCredits = credits.reduce((sum, cr) => sum + Math.abs(cr.amount_total), 0);
      const totalSales = totalInvoices - totalCredits;
      
      const approved = deposits
        .filter(d => d.status === 'approved')
        .reduce((sum, d) => sum + d.net_amount, 0);
      
      const pending = deposits
        .filter(d => d.status === 'pending')
        .reduce((sum, d) => sum + d.net_amount, 0);

      periods.push({
        period: 'Custom Period',
        periodStart: appliedStartDate,
        periodEnd: appliedEndDate,
        sales: totalSales,
        approvedDeposits: approved,
        pendingDeposits: pending,
        gap: totalSales - approved,
        gapAfterPending: totalSales - approved - pending,
      });
    }

    setPeriodComparisons(periods);
  };

  // Don't block rendering with a full-screen spinner on initial load so skeletons can display in-place.
  // The UI components (stat cards, chart, method table) render skeletons when `loading` or `loadingMethodSummaries` are true.

  const statCards = [
    {
      title: 'Total Sales',
      value: formatCurrency(Number(stats.totalSales) || 0),
      subtitle: 'In selected period',
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Actual Deposits',
      value: formatCurrency(Number(stats.actualDepositsAmount) || 0),
      subtitle: `${stats.actualDepositsCount} Actual Deposits`,
      icon: Wallet,
      color: 'bg-purple-500',
    },
    {
      title: 'Approved Deposits',
      value: (
        <div>
          <div className="text-2xl font-semibold text-gray-900">{formatCurrency(Number(stats.approvedDepositsGroupAmount) || 0)}</div>
          {/* <div className="text-sm text-gray-600">{formatCurrency(stats.approvedDepositsGroupAmount)} grouped ({stats.approvedDepositsGroupCount} groups)</div> */}
                    {/* <div className="text-sm text-gray-600"> ({stats.approvedDepositsGroupCount} groups)</div> */}

        </div>
      ),
      // subtitle: (
      //   <div className="text-xs text-gray-500">{stats.approvedDepositsCount} deposits (individual)</div>
      // ),
      icon: CheckCircle,
      color: 'bg-blue-500',
    },

    {
      title: 'Pending Deposits',
      value: formatCurrency(Number(stats.pendingDepositsAmount) || 0),
      subtitle: `${stats.pendingDepositsCount} awaiting approval`,
      icon: Clock,
      color: 'bg-yellow-500',
    },
    {
      title: 'Gap (Missing)',
      value: formatCurrency(Number(stats.gapAmount) || 0),
      subtitle: stats.gapAfterPending < 0 
        ? `✅ Covered if pending approved` 
        : `⚠️ ${formatCurrency(Number(stats.gapAfterPending) || 0)} still missing after pending`,
      icon: AlertTriangle,
      color: stats.gapAmount > 0 ? 'bg-red-500' : 'bg-green-500',
    },
  ];
  
  // 🔍 LOGGING: Log when cards are rendered
  console.log('📊 [DASHBOARD CARDS] Rendering with stats:', {
    actualDepositsAmount: stats.actualDepositsAmount,
    actualDepositsCount: stats.actualDepositsCount,
    formatted: `EGP ${stats.actualDepositsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${stats.actualDepositsCount} allocations)`,
    approvedDepositsAmount: stats.approvedDepositsAmount,
    totalSales: stats.totalSales,
    gap: stats.gapAmount
  });

  // Filter period comparisons based on search term
  const filteredPeriodComparisons = useMemo(() => {
    if (!periodSearchTerm.trim()) {
      return periodComparisons;
    }
    
    const searchLower = periodSearchTerm.toLowerCase();
    return periodComparisons.filter(period => 
      period.period.toLowerCase().includes(searchLower) ||
      period.periodStart.toLowerCase().includes(searchLower) ||
      period.periodEnd.toLowerCase().includes(searchLower) ||
      period.sales.toString().includes(searchLower) ||
      period.approvedDeposits.toString().includes(searchLower) ||
      period.pendingDeposits.toString().includes(searchLower) ||
      period.gap.toString().includes(searchLower)
    );
  }, [periodComparisons, periodSearchTerm]);

  // Memoized methods table data to prevent recalculation on every render
  const methodsTableData = useMemo(() => {
    const filtered = methodSummaries
      .filter(m => appliedMethod === 'all' || m.payment_method_id === appliedMethod)
      .filter(m => 
        methodSearchTerm === '' || 
        m.name?.toLowerCase().includes(methodSearchTerm.toLowerCase()) ||
        m.payment_method_id?.toLowerCase().includes(methodSearchTerm.toLowerCase())
      );
    
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / methodItemsPerPage));
    
    const start = (methodPage - 1) * methodItemsPerPage;
    const end = start + methodItemsPerPage;
    const pageItems = filtered.slice(start, end);

    // compute totals across filtered set
    const totals = filtered.reduce((acc, cur) => {
      acc.net += Number(cur.netInvoices || 0);
      acc.approved += Number(cur.approvedAlloc || 0);
      acc.pending += Number(cur.pendingAmt || 0);
      acc.gap += Number(cur.gap || 0);
      return acc;
    }, { net: 0, approved: 0, pending: 0, gap: 0 });

    return {
      filtered,
      totalCount,
      totalPages,
      pageItems,
      totals,
      start,
      end
    };
  }, [methodSummaries, appliedMethod, methodSearchTerm, methodPage, methodItemsPerPage]);

  // Reset method page if it's out of bounds after filtering
  useEffect(() => {
    if (methodPage > methodsTableData.totalPages && methodsTableData.totalPages > 0) {
      setMethodPage(1);
    }
  }, [methodPage, methodsTableData.totalPages]);

  // Reset current page if it's out of bounds after filtering
  useEffect(() => {
    const maxPages = Math.ceil(filteredPeriodComparisons.length / itemsPerPage);
    if (currentPage > maxPages && maxPages > 0) {
      setCurrentPage(1);
    }
  }, [filteredPeriodComparisons.length, currentPage, itemsPerPage]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      {/* Loading Overlay - Only show for initial load and refresh allocations */}
      {(loading || refreshingAllocations) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <div className="flex items-center space-x-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {refreshingAllocations ? 'Refreshing Allocations' : 
                   loadingMethodSummaries ? 'Loading Method Summaries' : 
                   applyingFilters ? 'Applying Filters' :
                   'Loading Dashboard Data'}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {refreshingAllocations ? 'Updating deposit allocations...' : 
                   loadingMethodSummaries ? 'Calculating payment method summaries...' : 
                   applyingFilters ? 'Applying your filter selections...' :
                   'Fetching dashboard data...'}
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Sales vs Deposits Analysis</h1>
          <p className="text-gray-600 mt-2">Track deposits coverage against sales by period</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Period Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Period Type</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as PeriodType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
              <select
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Methods</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name_en}
                  </option>
                ))}
              </select>
            </div>

            {/* Apply Button */}
            <div className="flex items-end gap-2">
              <button
                onClick={handleApplyFilters}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Apply Filters
              </button>
              
              {/* Refresh Allocations Button */}
              <button
                onClick={handleRefreshAllocations}
                disabled={refreshingAllocations}
                title="Recalculate deposit allocations based on current invoices and deposits"
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {refreshingAllocations ? (
                  <>
                    <span className="inline-block animate-spin mr-2">⟳</span>
                    Refreshing...
                  </>
                ) : (
                  '🔄 Refresh Allocations'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 mb-8">
          {loading ? (
            // Skeleton placeholders while initial loading
            Array.from({ length: 5 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))
          ) : (
            statCards.map((stat, index) => {
              const isUpdating = applyingFilters || loadingMethodSummaries;
              const Icon = stat.icon;
              return (
                <LoadingWrapper 
                  key={index}
                  isLoading={isUpdating} 
                  showOldData={true}
                  loadingText="Updating..."
                >
                  <div className="bg-white overflow-hidden shadow rounded-lg min-w-[260px] m-2">
                    <div className="p-5">
                    <div className="flex items-center">
                      <div className={`flex-shrink-0 rounded-md p-3 ${stat.color}`}>
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 truncate">
                            {stat.title}
                          </dt>
                          <dd>
                            <div className="text-2xl font-semibold text-gray-900 min-w-[220px] whitespace-nowrap">
                              {stat.value}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {stat.subtitle}
                            </div>
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
                </LoadingWrapper>
              );
            })
          )}
        </div>

        {/* Chart */}
        <LoadingWrapper 
          isLoading={applyingFilters} 
          showOldData={true}
          loadingText="Updating..."
        >
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-6">Sales vs Deposits Comparison</h3>
          {loading ? (
            // Improved chart skeleton
            <div className="space-y-6 animate-pulse">
              {/* Legend skeleton */}
              <div className="flex justify-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-32"></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-28"></div>
                </div>
              </div>
              
              {/* Chart area skeleton */}
              <div className="relative" style={{ height: '450px' }}>
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-12 flex flex-col justify-between text-xs pr-2">
                  {[5, 4, 3, 2, 1, 0].map(i => (
                    <div key={i} className="h-4 bg-gray-200 rounded w-12"></div>
                  ))}
                </div>
                
                {/* Chart bars */}
                <div className="absolute left-20 right-0 top-0 bottom-12 px-2">
                  <div className="relative h-full flex items-end gap-2">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <div key={idx} className="flex-1 h-full flex items-end gap-0.5">
                        {/* Sales bar */}
                        <div className="flex-1 bg-gray-200 rounded-t" style={{ height: `${25 + (idx % 3) * 15}%` }} />
                        {/* Approved bar */}
                        <div className="flex-1 bg-gray-300 rounded-t" style={{ height: `${20 + (idx % 4) * 10}%` }} />
                        {/* Pending bar */}
                        <div className="flex-1 bg-gray-200 rounded-t" style={{ height: `${10 + (idx % 2) * 5}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* X-axis labels */}
                <div className="absolute left-20 right-0 bottom-0 flex items-center gap-2 px-2 h-12">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex-1 flex items-center justify-center">
                      <div className="h-3 bg-gray-200 rounded w-16"></div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Gap summary cards skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="rounded-lg p-5 border-2 border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="h-5 bg-gray-200 rounded w-20"></div>
                      <div className="h-5 bg-gray-200 rounded w-16"></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="h-4 bg-gray-200 rounded w-16"></div>
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </div>
                      <div className="flex justify-between items-center">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                        <div className="h-4 bg-gray-200 rounded w-16"></div>
                      </div>
                      <div className="pt-2 mt-2 border-t-2 border-gray-200">
                        <div className="flex justify-between items-center">
                          <div className="h-4 bg-gray-200 rounded w-24"></div>
                          <div className="h-5 bg-gray-200 rounded w-20"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : periodComparisons.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {/* Legend */}
                <div className="flex justify-center gap-6 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-500 rounded"></div>
                    <span className="text-sm text-gray-700">Sales</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                    <span className="text-sm text-gray-700">Approved Deposits</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-yellow-400 rounded"></div>
                    <span className="text-sm text-gray-700">Pending Deposits</span>
                  </div>
                </div>

                {/* Bar Chart - Optimized with Horizontal Scrolling */}
                <div className="relative" style={{ height: '450px' }}>
                  {(() => {
                    // Calculate max value once for the entire chart
                    const maxValue = Math.max(...periodComparisons.map(p => 
                      Math.max(p.sales, p.approvedDeposits + p.pendingDeposits)
                    ), 1); // Minimum 1 to avoid division by zero
                    
                    const step = Math.ceil(maxValue / 5 / 1000) * 1000;
                    const yAxisMax = step * 5;
                    
                    // Dynamic sizing based on number of periods
                    const numPeriods = periodComparisons.length;
                    const isLargeDataset = numPeriods > 20;
                    const barWidth = isLargeDataset ? 30 : 80; // px per period
                    const containerWidth = Math.max(numPeriods * (barWidth + 8), 800); // minimum 800px

                    return (
                      <div className="overflow-x-auto max-w-full">
                        <div className="relative" style={{ height: '450px', width: `${containerWidth}px` }}>
                          {/* Y-axis labels */}
                          <div className="absolute left-0 top-0 bottom-12 flex flex-col justify-between text-xs text-gray-500 pr-2">
                            {[5, 4, 3, 2, 1, 0].map(i => (
                              <div key={i} className="text-right w-16">
                                {formatCurrency(Number(step * i) || 0)}
                              </div>
                            ))}
                          </div>

                          {/* Grid lines */}
                          <div className="absolute left-20 right-0 top-0 bottom-12 flex flex-col justify-between">
                            {[0, 1, 2, 3, 4, 5].map(i => (
                              <div key={i} className="border-t border-gray-200"></div>
                            ))}
                          </div>

                          {/* Bars Container - Optimized */}
                          <div className="absolute left-20 right-0 top-0 bottom-12 px-2">
                            <div className="relative h-full flex items-end gap-2">
                              {periodComparisons.map((period, idx) => {
                                const salesHeight = yAxisMax > 0 ? (period.sales / yAxisMax) * 100 : 0;
                                const approvedHeight = yAxisMax > 0 ? (period.approvedDeposits / yAxisMax) * 100 : 0;
                                const pendingHeight = yAxisMax > 0 ? (period.pendingDeposits / yAxisMax) * 100 : 0;

                                return (
                                  <div key={idx} className="flex justify-center items-end gap-0.5 h-full" style={{ width: `${barWidth}px`, flexShrink: 0 }}>
                                    {/* Sales Bar */}
                                    <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                      <div 
                                        className="w-full bg-green-500 rounded-t hover:bg-green-600 transition-colors cursor-pointer"
                                        style={{ height: `${salesHeight}%`, minHeight: period.sales > 0 ? '2px' : '0' }}
                                      />
                                      {/* Tooltip */}
                                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded py-1 px-2 whitespace-nowrap z-10">
                                        {formatCurrency(Number(period.sales) || 0)}
                                      </div>
                                    </div>

                                    {/* Approved Bar */}
                                    <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                      <div 
                                        className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors cursor-pointer"
                                        style={{ height: `${approvedHeight}%`, minHeight: period.approvedDeposits > 0 ? '2px' : '0' }}
                                      />
                                      {/* Tooltip */}
                                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded py-1 px-2 whitespace-nowrap z-10">
                                        {formatCurrency(Number(period.approvedDeposits) || 0)}
                                      </div>
                                    </div>

                                    {/* Pending Bar */}
                                    <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                      <div 
                                        className="w-full bg-yellow-400 rounded-t hover:bg-yellow-500 transition-colors cursor-pointer"
                                        style={{ height: `${pendingHeight}%`, minHeight: period.pendingDeposits > 0 ? '2px' : '0' }}
                                      />
                                      {/* Tooltip */}
                                      {period.pendingDeposits > 0 && (
                                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded py-1 px-2 whitespace-nowrap z-10">
                                          {formatCurrency(Number(period.pendingDeposits) || 0)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* X-axis labels - Optimized */}
                          <div className="absolute left-20 right-0 bottom-0 flex items-center gap-2 px-2 h-12" style={{ width: '100%' }}>
                            {periodComparisons.map((period, idx) => (
                              <div key={idx} className="flex items-center justify-center" style={{ width: `${barWidth}px`, flexShrink: 0 }}>
                                <div className={`text-gray-600 text-center ${isLargeDataset ? 'text-[9px]' : 'text-xs'}`}>
                                  {period.period}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Info Message for Large Datasets */}
                {periodComparisons.length > 20 && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span>📊 Scroll horizontally to see all {periodComparisons.length} periods</span>
                  </div>
                )}

                {/* Gap Summary Below Chart - Show All Periods */}
                <div className="mt-8">
                  <div className="max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {periodComparisons.map((period, idx) => (
                        <div key={idx} className={`rounded-lg p-5 border-2 ${
                          period.gap > 0 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-base font-bold text-gray-900">{period.period}</div>
                            {period.gap > 0 ? (
                              <span className="bg-red-500 text-white text-xs px-3 py-1 rounded-full font-bold">
                                ⚠️ Missing
                              </span>
                            ) : (
                              <span className="bg-green-500 text-white text-xs px-3 py-1 rounded-full font-bold">
                                ✅ Complete
                              </span>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600">💰 Sales:</span>
                              <div className="text-right">
                                <div className="font-bold text-gray-900">{formatCurrency(Number(period.sales) || 0)}</div>
                                {typeof period.dailySalesAllocations === 'number' && Math.abs(period.dailySalesAllocations - period.sales) > 0.5 && (
                                  <div className="text-xs text-gray-500">Alloc: {formatCurrency(Number(period.dailySalesAllocations) || 0)}</div>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600">✅ Approved:</span>
                              <span className="font-semibold text-blue-700">{formatCurrency(Number(period.approvedDeposits) || 0)}</span>
                            </div>
                            {period.pendingDeposits > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600">⏳ Pending:</span>
                                <span className="font-semibold text-yellow-600">{formatCurrency(Number(period.pendingDeposits) || 0)}</span>
                              </div>
                            )}
                            
                            <div className="pt-2 mt-2 border-t-2 border-gray-300">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-bold text-gray-700">Current Gap:</span>
                                <span className={`text-lg font-bold ${period.gap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  {period.gap > 0 ? '⚠️ ' : '✅ '}{formatCurrency(Math.abs(Number(period.gap)) || 0)}
                                </span>
                              </div>
                              {period.pendingDeposits > 0 && (
                                <div className="flex justify-between items-center mt-1 text-xs">
                                  <span className="text-gray-600">If pending approved:</span>
                                  <span className={`font-semibold ${period.gapAfterPending > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                                    {period.gapAfterPending > 0 
                                      ? `⚠️ Still ${formatCurrency(Number(period.gapAfterPending) || 0)} missing` 
                                      : '✅ Fully covered'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400">
              No data available for selected period
            </div>
          )}
        </div>
        </LoadingWrapper>

        {/* Comparison Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {/* Header with Download, Search and Count */}
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gray-50 gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <h3 className="text-lg font-medium text-gray-900">Detailed Comparison Table</h3>
              <span className="text-sm text-gray-600">
                Total: <span className="font-medium">{filteredPeriodComparisons.length}</span> periods
                {periodSearchTerm && <span className="text-blue-600"> (filtered from {periodComparisons.length})</span>}
              </span>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Search Bar */}
              <div className="relative flex-1 sm:flex-initial">
                <input
                  type="text"
                  placeholder="Search methods..."
                  value={methodSearchTerm}
                  onChange={(e) => {
                    setMethodSearchTerm(e.target.value);
                    setMethodPage(1); // Reset to first page when searching
                  }}
                  className="w-full sm:w-64 pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              
              <button
                onClick={downloadComparisonCSV}
                disabled={periodComparisons.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4m0 0V8m0 4H8m4 0h4" />
                </svg>
                Download CSV
              </button>
            </div>
          </div>

          {/* Method Summaries (per payment method) */}
          <LoadingWrapper 
            isLoading={applyingFilters} 
            showOldData={true}
            loadingText="Updating..."
          >
          <div className="px-6 py-4 border-b border-gray-200 bg-white">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Methods in period</h4>
              <span className="text-sm text-gray-600">
                Total: <span className="font-medium">{methodsTableData.totalCount}</span> methods
                {methodSearchTerm && <span className="text-blue-600"> (filtered from {methodSummaries.filter(m => appliedMethod === 'all' || m.payment_method_id === appliedMethod).length})</span>}
              </span>
            </div>
            {loadingMethodSummaries ? (
              // Skeleton table with 6 rows
              <div className="overflow-x-auto bg-white rounded">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="w-1/3 text-left px-2 py-1">Method</th>
                      <th className="w-1/6 text-right px-2 py-1">Net Sales</th>
                      <th className="w-1/6 text-right px-2 py-1">Approved</th>
                      <th className="w-1/6 text-right px-2 py-1">Pending</th>
                      <th className="w-1/6 text-right px-2 py-1">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-t animate-pulse">
                        <td className="px-2 py-2">
                          <div className="h-4 bg-gray-200 rounded w-32"></div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="h-4 bg-gray-200 rounded w-12 ml-auto"></div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="h-4 bg-gray-200 rounded w-12 ml-auto"></div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : methodSummaries.length === 0 ? (
              <div className="text-sm text-gray-500">No active methods in selected period</div>
            ) : (
              <div className="overflow-x-auto bg-white rounded">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="w-1/3 text-left px-2 py-1">Method</th>
                      <th className="w-1/6 text-right px-2 py-1">Net Sales</th>
                      <th className="w-1/6 text-right px-2 py-1">Approved</th>
                      <th className="w-1/6 text-right px-2 py-1">Pending</th>
                      <th className="w-1/6 text-right px-2 py-1">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {
                      // Use memoized methods table data
                      (() => {
                        const { pageItems, totals, totalCount, totalPages, start, end } = methodsTableData;

                        return (
                          <>
                            {pageItems.map(ms => (
                              <tr key={ms.payment_method_id} className="border-t">
                                <td className="px-2 py-2">{ms.name}</td>
                                <td className="px-2 py-2 text-right">{formatCurrency(Number(ms.netInvoices) || 0)}</td>
                                <td className="px-2 py-2 text-right">{formatCurrency(Number(ms.approvedAlloc) || 0)}</td>
                                <td className="px-2 py-2 text-right">{formatCurrency(Number(ms.pendingAmt) || 0)}</td>
                                <td className="px-2 py-2 text-right">
                                  {ms.gap === 0 ? (
                                    <span className="text-green-600 font-semibold">✅ {formatCurrency(Math.abs(ms.gap))}</span>
                                  ) : (
                                    <span className="text-red-600 font-semibold">⚠️ {formatCurrency(Math.abs(ms.gap))}</span>
                                  )}
                                </td>
                              </tr>
                            ))}

                            {/* Totals row */}
                            <tr className="border-t bg-gray-50">
                              <td className="px-2 py-2 font-bold">Total</td>
                              <td className="px-2 py-2 text-right font-bold">{formatCurrency(totals.net)}</td>
                              <td className="px-2 py-2 text-right font-bold">{formatCurrency(totals.approved)}</td>
                              <td className="px-2 py-2 text-right font-bold">{formatCurrency(totals.pending)}</td>
                              <td className="px-2 py-2 text-right font-bold">
                                {totals.gap === 0 ? (
                                  <span className="text-green-600">✅ {formatCurrency(Math.abs(totals.gap))}</span>
                                ) : (
                                  <span className="text-red-600">⚠️ {formatCurrency(Math.abs(totals.gap))}</span>
                                )}
                              </td>
                            </tr>

                            {/* Pagination controls */}
                            <tr>
                              <td colSpan={5} className="px-2 py-3">
                                <div className="flex items-center justify-between">
                                  <div className="text-sm text-gray-500">Showing {Math.min(start + 1, totalCount)} - {Math.min(end, totalCount)} of {totalCount}</div>
                                  <div className="flex items-center gap-2">
                                    <select value={methodItemsPerPage} onChange={(e) => { setMethodItemsPerPage(Number(e.target.value)); setMethodPage(1); }} className="border rounded px-2 py-1 text-sm">
                                      <option value={5}>5</option>
                                      <option value={10}>10</option>
                                      <option value={25}>25</option>
                                      <option value={50}>50</option>
                                    </select>

                                    <button onClick={() => setMethodPage(p => Math.max(1, p - 1))} disabled={methodPage <= 1} className="px-2 py-1 rounded border disabled:opacity-50">Prev</button>
                                    <span className="text-sm">{methodPage} / {totalPages}</span>
                                    <button onClick={() => setMethodPage(p => Math.min(totalPages, p + 1))} disabled={methodPage >= totalPages} className="px-2 py-1 rounded border disabled:opacity-50">Next</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          </>
                        );
                      })()
                    }
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </LoadingWrapper>
          <LoadingWrapper 
            isLoading={applyingFilters} 
            showOldData={true}
            loadingText="Updating..."
          >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Approved</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gap</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  // Skeleton loading for comparison table
                  Array.from({ length: 8 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-4 bg-gray-200 rounded w-16 ml-auto"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-4 bg-gray-200 rounded w-16 ml-auto"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-4 bg-gray-200 rounded w-18 ml-auto"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="h-5 bg-gray-200 rounded w-16 mx-auto"></div>
                      </td>
                    </tr>
                  ))
                ) : filteredPeriodComparisons.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      {periodSearchTerm ? 'No periods match your search' : 'No data available'}
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const totalPages = Math.ceil(filteredPeriodComparisons.length / itemsPerPage);
                    const startIdx = (currentPage - 1) * itemsPerPage;
                    const endIdx = startIdx + itemsPerPage;
                    const paginatedData = filteredPeriodComparisons.slice(startIdx, endIdx);
                    
                    return paginatedData.map((period, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {period.period}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(period.sales)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600">
                      {formatCurrency(period.approvedDeposits)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-yellow-600">
                      {formatCurrency(period.pendingDeposits)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold">
                      <span className={period.gap > 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatCurrency(Math.abs(period.gap))}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {period.gap === 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✅ Complete
                        </span>
                      ) : period.gapAfterPending <= 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          ⏳ Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          ⚠️ Missing
                        </span>
                      )}
                    </td>
                  </tr>
                    ));
                  })()
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Footer */}
          {filteredPeriodComparisons.length > 0 && (
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredPeriodComparisons.length)}-{Math.min(currentPage * itemsPerPage, filteredPeriodComparisons.length)} of {filteredPeriodComparisons.length} periods
                {periodSearchTerm && <span className="text-blue-600"> (filtered)</span>}
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
                  <span className="text-gray-600">{Math.ceil(filteredPeriodComparisons.length / itemsPerPage)}</span>
                </div>
                
                <button
                  onClick={() => setCurrentPage(Math.min(Math.ceil(filteredPeriodComparisons.length / itemsPerPage), currentPage + 1))}
                  disabled={currentPage >= Math.ceil(filteredPeriodComparisons.length / itemsPerPage)}
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
          </LoadingWrapper>
        </div>
      </main>
    </div>
  );
}

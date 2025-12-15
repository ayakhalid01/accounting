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
  // Load Saved Filters from localStorage
  // ============================================
  const getSavedFilters = () => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('invoices_filters');
    return saved ? JSON.parse(saved) : null;
  };
  
  const savedFilters = getSavedFilters();
  
  // ============================================
  // State - Only Current Page Data
  // ============================================
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credits, setCredits] = useState<CreditNote[]>([]);
  
  // Batch loading state
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ loaded: 0, total: 0, currentBatch: 0 });
  
  // Statistics from database view (ALL data, instant)
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  
  // Filters - Restored from localStorage (INPUT FILTERS - update immediately)
  const [documentType, setDocumentType] = useState<DocumentType>(savedFilters?.documentType || 'all');
  const [searchTerm, setSearchTerm] = useState(savedFilters?.searchTerm || '');
  const [startDate, setStartDate] = useState(savedFilters?.startDate || '2025-11-01');
  const [endDate, setEndDate] = useState(savedFilters?.endDate || '2025-12-31');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(savedFilters?.selectedPaymentMethod || 'all');
  const [hasCreditsFilter, setHasCreditsFilter] = useState<'all' | 'with_credits' | 'no_credits'>(savedFilters?.hasCreditsFilter || 'all');
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  
  // Applied Filters (APPLIED FILTERS - update only on button click)
  const [appliedDocumentType, setAppliedDocumentType] = useState<DocumentType>(savedFilters?.documentType || 'all');
  const [appliedSearchTerm, setAppliedSearchTerm] = useState(savedFilters?.searchTerm || '');
  const [appliedStartDate, setAppliedStartDate] = useState(savedFilters?.startDate || '2025-11-01');
  const [appliedEndDate, setAppliedEndDate] = useState(savedFilters?.endDate || '2025-12-31');
  const [appliedPaymentMethod, setAppliedPaymentMethod] = useState(savedFilters?.selectedPaymentMethod || 'all');
  const [appliedHasCreditsFilter, setAppliedHasCreditsFilter] = useState<'all' | 'with_credits' | 'no_credits'>(savedFilters?.hasCreditsFilter || 'all');
  
  // Sort - Restored from localStorage
  const [sortField, setSortField] = useState<'sale_order_date' | 'amount_total'>(savedFilters?.sortField || 'sale_order_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(savedFilters?.sortOrder || 'desc');
  
  // Pagination - Restored from localStorage
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(savedFilters?.itemsPerPage || 100); // Default 100 rows

  // ============================================
  // Save Filters to localStorage
  // ============================================
  useEffect(() => {
    const filtersToSave = {
      documentType,
      searchTerm,
      startDate,
      endDate,
      selectedPaymentMethod,
      hasCreditsFilter,
      sortField,
      sortOrder,
      itemsPerPage
    };
    localStorage.setItem('invoices_filters', JSON.stringify(filtersToSave));
  }, [documentType, searchTerm, startDate, endDate, selectedPaymentMethod, hasCreditsFilter, sortField, sortOrder, itemsPerPage]);

  // ============================================
  // Apply Filters Button Handler - Uses Batch Loading
  // ============================================
  const handleApplyFilters = async () => {
    // Update applied filters immediately
    setAppliedDocumentType(documentType);
    setAppliedSearchTerm(searchTerm);
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setAppliedPaymentMethod(selectedPaymentMethod);
    setAppliedHasCreditsFilter(hasCreditsFilter);
    setCurrentPage(1); // Reset to page 1
    
    console.log('✅ [FILTERS] Applied filters:', {
      documentType,
      searchTerm,
      startDate,
      endDate,
      selectedPaymentMethod,
      hasCreditsFilter
    });
    
    // Start batch loading with progress dialog
    setIsBatchLoading(true);
    setBatchProgress({ loaded: 0, total: 0, currentBatch: 0 });
    
    // IMPORTANT: Clear old data before loading new data
    setInvoices([]);
    setCredits([]);
    
    // Use the NEW filter values (not the state which updates asynchronously)
    const newFilters = {
      appliedStartDate: startDate,
      appliedEndDate: endDate,
      appliedPaymentMethod: selectedPaymentMethod,
      appliedDocumentType: documentType,
      appliedSearchTerm: searchTerm,
      appliedHasCreditsFilter: hasCreditsFilter
    };
    
    try {
      await Promise.all([
        loadAllInvoicesInBatchesWithFilters(newFilters),
        loadAllCreditsInBatchesWithFilters(newFilters),
        loadStatisticsWithFilters(newFilters)
      ]);
      
      console.log('✅ [FILTERS] All data loaded successfully');
    } catch (error) {
      console.error('❌ [FILTERS] Error loading batches:', error);
    } finally {
      setIsBatchLoading(false);
      setLoading(false);
    }
  };

  // ============================================
  // Load Statistics with Filters (All Users See All Data)
  // ============================================
  const loadStatistics = async () => {
    try {
      console.log('📊 [STATS] Loading aggregations with filters...');
      console.log('📊 [STATS] Filters:', { appliedStartDate, appliedEndDate, appliedPaymentMethod });
      
      const nextDay = new Date(appliedEndDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      
      const { data: aggData, error: aggError } = await supabase.rpc('get_dashboard_aggregations', {
        p_start_date: appliedStartDate,
        p_end_date: appliedEndDate,
        p_payment_method_id: appliedPaymentMethod === 'all' ? null : appliedPaymentMethod
      });

      if (aggError) {
        console.error('❌ [STATS] Aggregation error:', aggError);
        return;
      }

      let invoicesCountQuery = supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'posted')
        .gte('sale_order_date', appliedStartDate)
        .lt('sale_order_date', nextDayStr);
      
      if (appliedPaymentMethod !== 'all') {
        invoicesCountQuery = invoicesCountQuery.eq('payment_method_id', appliedPaymentMethod);
      }
      
      let creditsCountQuery = supabase
        .from('credit_notes')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null)
        .gte('sale_order_date', appliedStartDate)
        .lt('sale_order_date', nextDayStr);
      
      if (appliedPaymentMethod !== 'all') {
        creditsCountQuery = creditsCountQuery.eq('payment_method_id', appliedPaymentMethod);
      }
      
      const [
        { count: invoicesCount },
        { count: creditsCount }
      ] = await Promise.all([
        invoicesCountQuery,
        creditsCountQuery
      ]);

      const invoicesTotal = aggData?.[0]?.total_invoices_amount || 0;
      const creditsTotal = aggData?.[0]?.total_credits_amount || 0;
      const netAmount = aggData?.[0]?.net_sales || 0;
      
      console.log('📊 [STATS] From RPC - Invoices total:', invoicesTotal);
      console.log('📊 [STATS] From count - Invoices count:', invoicesCount);
      
      setStatistics({
        total_invoices_amount: invoicesTotal,
        total_credits_amount: creditsTotal,
        net_amount: netAmount,
        total_invoices_count: invoicesCount || 0,
        total_credits_count: creditsCount || 0,
        last_updated: new Date().toISOString()
      });
      
      console.log('✅ [STATS] Loaded:', {
        invoices_amount: invoicesTotal,
        invoices_count: invoicesCount,
        credits_amount: creditsTotal,
        credits_count: creditsCount,
        net: netAmount
      });
      
    } catch (error) {
      console.error('❌ [STATS] Exception:', error);
    }
  };

  // ============================================
  // Load Statistics with Custom Filters (for Apply Filters)
  // ============================================
  const loadStatisticsWithFilters = async (filters: any) => {
    try {
      console.log('📊 [STATS] Loading aggregations with filters...');
      console.log('📊 [STATS] Filters:', { 
        startDate: filters.appliedStartDate, 
        endDate: filters.appliedEndDate, 
        paymentMethod: filters.appliedPaymentMethod 
      });
      
      const nextDay = new Date(filters.appliedEndDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      
      const { data: aggData, error: aggError } = await supabase.rpc('get_dashboard_aggregations', {
        p_start_date: filters.appliedStartDate,
        p_end_date: filters.appliedEndDate,
        p_payment_method_id: filters.appliedPaymentMethod === 'all' ? null : filters.appliedPaymentMethod
      });

      if (aggError) {
        console.error('❌ [STATS] Aggregation error:', aggError);
        return;
      }

      let invoicesCountQuery = supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'posted')
        .gte('sale_order_date', filters.appliedStartDate)
        .lt('sale_order_date', nextDayStr);
      
      if (filters.appliedPaymentMethod !== 'all') {
        invoicesCountQuery = invoicesCountQuery.eq('payment_method_id', filters.appliedPaymentMethod);
      }
      
      let creditsCountQuery = supabase
        .from('credit_notes')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null)
        .gte('sale_order_date', filters.appliedStartDate)
        .lt('sale_order_date', nextDayStr);
      
      if (filters.appliedPaymentMethod !== 'all') {
        creditsCountQuery = creditsCountQuery.eq('payment_method_id', filters.appliedPaymentMethod);
      }
      
      const [
        { count: invoicesCount },
        { count: creditsCount }
      ] = await Promise.all([
        invoicesCountQuery,
        creditsCountQuery
      ]);

      const invoicesTotal = aggData?.[0]?.total_invoices_amount || 0;
      const creditsTotal = aggData?.[0]?.total_credits_amount || 0;
      const netAmount = aggData?.[0]?.net_sales || 0;
      
      console.log('📊 [STATS] From RPC - Invoices total:', invoicesTotal);
      console.log('📊 [STATS] From count - Invoices count:', invoicesCount);
      
      setStatistics({
        total_invoices_amount: invoicesTotal,
        total_credits_amount: creditsTotal,
        net_amount: netAmount,
        total_invoices_count: invoicesCount || 0,
        total_credits_count: creditsCount || 0,
        last_updated: new Date().toISOString()
      });
      
      console.log('✅ [STATS] Loaded:', {
        invoices_amount: invoicesTotal,
        invoices_count: invoicesCount,
        credits_amount: creditsTotal,
        credits_count: creditsCount,
        net: netAmount
      });
      
    } catch (error) {
      console.error('❌ [STATS] Exception:', error);
    }
  };

  // ============================================
  // Load All Invoices in Batches (1000 rows at a time)
  // ============================================
  const loadAllInvoicesInBatches = async () => {
    try {
      console.log('📥 [BATCH] Starting batch load of invoices...');
      const BATCH_SIZE = 1000;
      let allInvoices: Invoice[] = [];
      let batchNumber = 0;
      let hasMore = true;

      while (hasMore) {
        const offset = batchNumber * BATCH_SIZE;
        console.log(`📥 [BATCH] Loading batch ${batchNumber + 1} (offset: ${offset}, limit: ${BATCH_SIZE})...`);
        
        let query = supabase
          .from('invoices')
          .select(`
            *,
            payment_method:payment_methods(id, name_en)
          `)
          .eq('state', 'posted');
        
        // Apply filters
        if (appliedStartDate) {
          query = query.gte('sale_order_date', appliedStartDate);
        }
        if (appliedEndDate) {
          const nextDay = new Date(appliedEndDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          query = query.lt('sale_order_date', nextDayStr);
        }
        
        if (appliedPaymentMethod !== 'all') {
          query = query.eq('payment_method_id', appliedPaymentMethod);
        }
        
        const { data, error } = await query
          .order('sale_order_date', { ascending: sortOrder === 'asc' })
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
          console.error('❌ [BATCH] Query error:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          console.log('📥 [BATCH] No more invoices to load');
        } else {
          allInvoices.push(...data);
          console.log(`✅ [BATCH] Loaded batch ${batchNumber + 1}: ${data.length} invoices (total: ${allInvoices.length})`);
          
          // Update progress - add loaded amount to total
          setBatchProgress(prev => ({
            loaded: allInvoices.length,
            total: prev.total + data.length,
            currentBatch: batchNumber + 1
          }));
          
          // Stop if we got fewer items than batch size (means we reached the end)
          if (data.length < BATCH_SIZE) {
            hasMore = false;
          }
        }

        batchNumber++;
        
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ [BATCH] Finished loading ${allInvoices.length} invoices total`);
      setInvoices(allInvoices);
      return allInvoices;
      
    } catch (error) {
      console.error('❌ [BATCH] Error loading invoices:', error);
      setInvoices([]);
      return [];
    }
  };

  // ============================================
  // Load All Invoices in Batches WITH Custom Filters (for Apply Filters)
  // ============================================
  const loadAllInvoicesInBatchesWithFilters = async (filters: any) => {
    try {
      console.log('📥 [BATCH] Starting batch load of invoices with custom filters...');
      console.log('📥 [BATCH] Using filters:', filters);
      const BATCH_SIZE = 1000;
      let allInvoices: Invoice[] = []; // Fresh array, not appending to state
      let batchNumber = 0;
      let hasMore = true;

      while (hasMore) {
        const offset = batchNumber * BATCH_SIZE;
        console.log(`📥 [BATCH] Loading batch ${batchNumber + 1} (offset: ${offset}, limit: ${BATCH_SIZE})...`);
        
        let query = supabase
          .from('invoices')
          .select(`
            *,
            payment_method:payment_methods(id, name_en)
          `)
          .eq('state', 'posted');
        
        // Apply filters from parameters (NOT from state)
        if (filters.appliedStartDate) {
          console.log('📥 [BATCH] Applying start date:', filters.appliedStartDate);
          query = query.gte('sale_order_date', filters.appliedStartDate);
        }
        if (filters.appliedEndDate) {
          const nextDay = new Date(filters.appliedEndDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          console.log('📥 [BATCH] Applying end date:', nextDayStr);
          query = query.lt('sale_order_date', nextDayStr);
        }
        
        if (filters.appliedPaymentMethod !== 'all') {
          console.log('📥 [BATCH] Applying payment method:', filters.appliedPaymentMethod);
          query = query.eq('payment_method_id', filters.appliedPaymentMethod);
        }
        
        const { data, error } = await query
          .order('sale_order_date', { ascending: sortOrder === 'asc' })
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
          console.error('❌ [BATCH] Query error:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          console.log('📥 [BATCH] No more invoices to load');
        } else {
          allInvoices.push(...data);
          console.log(`✅ [BATCH] Loaded batch ${batchNumber + 1}: ${data.length} invoices (total: ${allInvoices.length})`);
          
          // Update progress
          setBatchProgress(prev => ({
            loaded: allInvoices.length,
            total: prev.total + data.length,
            currentBatch: batchNumber + 1
          }));
          
          if (data.length < BATCH_SIZE) {
            hasMore = false;
          }
        }

        batchNumber++;
        
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ [BATCH] Finished loading ${allInvoices.length} invoices total`);
      console.log(`📥 [BATCH] Setting invoices state to ${allInvoices.length} items`);
      setInvoices(allInvoices);
      return allInvoices;
      
    } catch (error) {
      console.error('❌ [BATCH] Error loading invoices:', error);
      setInvoices([]);
      return [];
    }
  };

  // ============================================
  // Load All Credits in Batches (1000 rows at a time)
  // ============================================
  const loadAllCreditsInBatches = async () => {
    try {
      console.log('📥 [BATCH] Starting batch load of credits...');
      const BATCH_SIZE = 1000;
      let allCredits: CreditNote[] = [];
      let batchNumber = 0;
      let hasMore = true;

      while (hasMore) {
        const offset = batchNumber * BATCH_SIZE;
        console.log(`📥 [BATCH] Loading credit batch ${batchNumber + 1} (offset: ${offset}, limit: ${BATCH_SIZE})...`);
        
        let query = supabase
          .from('credit_notes')
          .select(`
            *,
            payment_method:payment_methods(id, name_en)
          `)
          .eq('state', 'posted')
          .not('original_invoice_id', 'is', null);
        
        // Apply filters
        if (appliedStartDate) {
          query = query.gte('sale_order_date', appliedStartDate);
        }
        if (appliedEndDate) {
          const nextDay = new Date(appliedEndDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          query = query.lt('sale_order_date', nextDayStr);
        }
        
        if (appliedPaymentMethod !== 'all') {
          query = query.eq('payment_method_id', appliedPaymentMethod);
        }
        
        const { data, error } = await query
          .order('credit_date', { ascending: sortOrder === 'asc' })
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
          console.error('❌ [BATCH] Query error:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          console.log('📥 [BATCH] No more credits to load');
        } else {
          allCredits.push(...data);
          console.log(`✅ [BATCH] Loaded credit batch ${batchNumber + 1}: ${data.length} credits (total: ${allCredits.length})`);
          
          // Update progress - add loaded amount to total
          setBatchProgress(prev => ({
            loaded: prev.loaded + data.length,
            total: prev.total + data.length,
            currentBatch: batchNumber + 1
          }));
          
          if (data.length < BATCH_SIZE) {
            hasMore = false;
          }
        }

        batchNumber++;
        
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ [BATCH] Finished loading ${allCredits.length} credits total`);
      setCredits(allCredits);
      return allCredits;
      
    } catch (error) {
      console.error('❌ [BATCH] Error loading credits:', error);
      setCredits([]);
      return [];
    }
  };

  // ============================================
  // Load All Credits in Batches WITH Custom Filters (for Apply Filters)
  // ============================================
  const loadAllCreditsInBatchesWithFilters = async (filters: any) => {
    try {
      console.log('📥 [BATCH] Starting batch load of credits with custom filters...');
      console.log('📥 [BATCH] Using filters:', filters);
      const BATCH_SIZE = 1000;
      let allCredits: CreditNote[] = []; // Fresh array, not appending to state
      let batchNumber = 0;
      let hasMore = true;

      while (hasMore) {
        const offset = batchNumber * BATCH_SIZE;
        console.log(`📥 [BATCH] Loading credit batch ${batchNumber + 1} (offset: ${offset}, limit: ${BATCH_SIZE})...`);
        
        let query = supabase
          .from('credit_notes')
          .select(`
            *,
            payment_method:payment_methods(id, name_en)
          `)
          .eq('state', 'posted')
          .not('original_invoice_id', 'is', null);
        
        // Apply filters from parameters (NOT from state)
        if (filters.appliedStartDate) {
          console.log('📥 [BATCH] Applying start date:', filters.appliedStartDate);
          query = query.gte('sale_order_date', filters.appliedStartDate);
        }
        if (filters.appliedEndDate) {
          const nextDay = new Date(filters.appliedEndDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          console.log('📥 [BATCH] Applying end date:', nextDayStr);
          query = query.lt('sale_order_date', nextDayStr);
        }
        
        if (filters.appliedPaymentMethod !== 'all') {
          console.log('📥 [BATCH] Applying payment method:', filters.appliedPaymentMethod);
          query = query.eq('payment_method_id', filters.appliedPaymentMethod);
        }
        
        const { data, error } = await query
          .order('credit_date', { ascending: sortOrder === 'asc' })
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
          console.error('❌ [BATCH] Query error:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          hasMore = false;
          console.log('📥 [BATCH] No more credits to load');
        } else {
          allCredits.push(...data);
          console.log(`✅ [BATCH] Loaded credit batch ${batchNumber + 1}: ${data.length} credits (total: ${allCredits.length})`);
          
          // Update progress
          setBatchProgress(prev => ({
            loaded: prev.loaded + data.length,
            total: prev.total + data.length,
            currentBatch: batchNumber + 1
          }));
          
          if (data.length < BATCH_SIZE) {
            hasMore = false;
          }
        }

        batchNumber++;
        
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ [BATCH] Finished loading ${allCredits.length} credits total`);
      console.log(`📥 [BATCH] Setting credits state to ${allCredits.length} items`);
      setCredits(allCredits);
      return allCredits;
      
    } catch (error) {
      console.error('❌ [BATCH] Error loading credits:', error);
      setCredits([]);
      return [];
    }
  };

  // ============================================
  // Load Payment Methods
  // ============================================
  const loadPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .order('name_en');

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
        loadAllInvoicesInBatches(),
        loadAllCreditsInBatches(),
        loadPaymentMethods()
      ]);
      
      setLoading(false);
      console.log('✅ [INVOICES] Initial load complete');
    };

    init();
  }, []);

  // ============================================
  // Reload When APPLIED Filters Change (including itemsPerPage)
  // ============================================
  useEffect(() => {
    if (!loading && invoices.length > 0) {
      // Reset to page 1 when filters change
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
      console.log('✅ [FILTERS] Filters changed, showing page 1');
    }
  }, [sortField, sortOrder, appliedStartDate, appliedEndDate, appliedPaymentMethod, appliedSearchTerm, appliedDocumentType, appliedHasCreditsFilter, itemsPerPage]);

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

    if (appliedDocumentType === 'all' || appliedDocumentType === 'invoices') {
      data.push(...invoicesWithCredits.map(inv => ({
        ...inv,
        type: 'invoice' as const,
        date: inv.sale_order_date,
        number: inv.invoice_number,
        amount: inv.amount_total
      })));
    }

    if (appliedDocumentType === 'all' || appliedDocumentType === 'credits') {
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
  }, [invoicesWithCredits, credits, appliedDocumentType]);

  // ============================================
  // Apply Filters (Client-Side, Current Page Only)
  // NOTE: Date range and payment method are already filtered server-side!
  // ============================================
  const filteredData = useMemo(() => {
    console.log('🔍 [FILTER] Applying client-side filters...');
    console.log('🔍 [FILTER] Search term:', appliedSearchTerm);
    console.log('🔍 [FILTER] Items to search:', combinedData.length, 'items');
    if (appliedSearchTerm) {
      console.log('🔍 [FILTER] Sample invoices in data:', combinedData.slice(0, 5).map(d => ({ number: d.number, type: d.type })));
    }
    let filtered = combinedData;

    // Search term (client-side only) - use APPLIED search
    if (appliedSearchTerm) {
      const search = appliedSearchTerm.toLowerCase();
      const beforeSearch = filtered.length;
      filtered = filtered.filter(item => 
        item.number?.toLowerCase().includes(search) ||
        item.customer_name?.toLowerCase().includes(search) ||
        item.invoiceNumber?.toLowerCase().includes(search)
      );
      console.log(`🔍 [FILTER] Searched for "${appliedSearchTerm}": Found ${filtered.length} matches (from ${beforeSearch} items)`);
    }

    // Credits filter (client-side only) - use APPLIED credits filter
    // Use has_credits flag that was calculated in invoicesWithCredits
    if (appliedHasCreditsFilter === 'with_credits' && appliedDocumentType !== 'credits') {
      console.log('🔍 [FILTER] Filtering for invoices WITH credits...');
      filtered = filtered.filter(item => 
        item.type === 'invoice' && item.has_credits === true
      );
      console.log(`🔍 [FILTER] Found ${filtered.length} invoices with credits`);
    } else if (appliedHasCreditsFilter === 'no_credits' && appliedDocumentType !== 'credits') {
      console.log('🔍 [FILTER] Filtering for invoices WITHOUT credits...');
      const beforeFilter = filtered.length;
      filtered = filtered.filter(item => 
        item.type === 'invoice' && item.has_credits === false
      );
      console.log(`🔍 [FILTER] Found ${filtered.length} invoices without credits (from ${beforeFilter} total)`);
    } else {
      console.log('🔍 [FILTER] No credits filter applied (showing all)');
    }

    console.log('✅ [FILTER] Final filtered count:', filtered.length);
    return filtered;
  }, [combinedData, appliedSearchTerm, appliedHasCreditsFilter, appliedDocumentType, credits]);

  // ============================================
  // Calculate Total Pages from Statistics
  // ============================================
  const totalPages = useMemo(() => {
    // Use actual filtered data length, not statistics (which is unfiltered total)
    const totalItems = filteredData.length;
    return Math.max(1, Math.ceil(totalItems / itemsPerPage));
  }, [filteredData, itemsPerPage]);

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
  // Download Filtered Data as CSV (SERVER-SIDE)
  // ============================================
  const downloadAllDataAsCSV = async () => {
    try {
      console.log('📥 [CSV] Generating filtered CSV on server...');
      console.log('📥 [CSV] Filters:', { startDate, endDate, selectedPaymentMethod, documentType });
      setLoading(true);

      // Call database function with current filters
      const { data, error } = await supabase.rpc('export_invoices_csv', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_payment_method_id: selectedPaymentMethod === 'all' ? null : selectedPaymentMethod,
        p_document_type: documentType
      });

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
      const filename = `invoices_credits_${startDate}_to_${endDate}_${new Date().toISOString().split('T')[0]}.csv`;
      link.download = filename;
      link.click();

      console.log(`✅ [CSV] Downloaded ${lineCount.toLocaleString()} records (server-generated with filters)`);
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
      
      {/* Batch Loading Progress Dialog */}
      {isBatchLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-xl font-bold mb-4 text-center">Loading Data...</h2>
            
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Progress</span>
                <span className="text-sm font-medium text-gray-700">{batchProgress.loaded.toLocaleString()} rows</span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.min((batchProgress.loaded / Math.max(1, batchProgress.loaded + 500)) * 100, 95)}%` }}
                ></div>
              </div>
            </div>

            <div className="space-y-2 text-center">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">Batch {batchProgress.currentBatch}:</span> Loading 1000 rows at a time
              </p>
              <p className="text-xs text-gray-500">
                This may take a few moments depending on data volume...
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          </div>
        </div>
      )}
      
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
            Download Filtered Data (CSV)
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
                    {method.name_en}
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

            {/* Apply Button */}
            <div className="flex items-end">
              <button
                onClick={handleApplyFilters}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Pagination - TOP */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                Page {currentPage} of {totalPages} • {filteredData.length} items on this page
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Show:</label>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
                <span className="text-sm text-gray-600">rows</span>
              </div>
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
                    <th className="px-4 py-3 text-left text-sm font-medium">Sales Date</th>
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
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.date ? (() => {
                          const d = new Date(item.date);
                          const year = d.getUTCFullYear();
                          const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                          const day = String(d.getUTCDate()).padStart(2, '0');
                          return `${day}/${month}/${year}`;
                        })() : '-'}
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
                        {item.payment_method?.name_en || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination - BOTTOM (duplicate for convenience) */}
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                Page {currentPage} of {totalPages} • {filteredData.length} items on this page
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Show:</label>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
                <span className="text-sm text-gray-600">rows</span>
              </div>
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

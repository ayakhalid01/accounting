'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { 
  DollarSign, 
  CheckCircle,
  Clock,
  AlertTriangle
} from 'lucide-react';

interface DashboardStats {
  totalSales: number;
  approvedDepositsAmount: number;
  pendingDepositsAmount: number;
  approvedDepositsCount: number;
  pendingDepositsCount: number;
  gapAmount: number;
  gapAfterPending: number;
}

interface PeriodComparison {
  period: string;
  periodStart: string;
  periodEnd: string;
  sales: number;
  approvedDeposits: number;
  pendingDeposits: number;
  gap: number;
  gapAfterPending: number;
}

type PeriodType = 'daily' | 'monthly' | 'custom';

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  const [stats, setStats] = useState<DashboardStats>({
    totalSales: 0,
    approvedDepositsAmount: 0,
    pendingDepositsAmount: 0,
    approvedDepositsCount: 0,
    pendingDepositsCount: 0,
    gapAmount: 0,
    gapAfterPending: 0,
  });
  
  const [periodComparisons, setPeriodComparisons] = useState<PeriodComparison[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  
  // Filters
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedMethod, setSelectedMethod] = useState<string>('all');

  useEffect(() => {
    const checkAuthAndLoadData = async () => {
      const { session } = await auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }
      
      // Set default dates (current month)
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(lastDay.toISOString().split('T')[0]);
      console.log('📅 Default date range:', firstDay.toISOString().split('T')[0], 'to', lastDay.toISOString().split('T')[0]);
      
      await loadPaymentMethods();
      setLoading(false);
    };

    checkAuthAndLoadData();
  }, [router]);

  useEffect(() => {
    if (startDate && endDate) {
      loadDashboardData();
    }
  }, [startDate, endDate, selectedMethod, periodType]);

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

  const loadDashboardData = async () => {
    try {
      console.log('🔍 Loading data with filters:', { startDate, endDate, selectedMethod, periodType });
      
      // ============================================
      // STEP 1: Get accurate totals from database (bypasses 1000 limit)
      // ============================================
      const { data: aggregations, error: aggError } = await supabase.rpc('get_dashboard_aggregations', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_payment_method_id: selectedMethod === 'all' ? null : selectedMethod
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
        .gte('sale_order_date', startDate)
        .lte('sale_order_date', endDate);

      // Get credits from credit_notes table
      let creditsQuery = supabase
        .from('credit_notes')
        .select('amount_total, sale_order_date, payment_method_id, original_invoice_id')
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null)
        .gte('sale_order_date', startDate)
        .lte('sale_order_date', endDate);

      let depositsQuery = supabase
        .from('deposits')
        .select('net_amount, status, start_date, end_date, payment_method_id')
        .or(`and(start_date.lte.${endDate},end_date.gte.${startDate})`);

      // Filter by payment method if selected
      if (selectedMethod !== 'all') {
        invoicesQuery = invoicesQuery.eq('payment_method_id', selectedMethod);
        creditsQuery = creditsQuery.eq('payment_method_id', selectedMethod);
        depositsQuery = depositsQuery.eq('payment_method_id', selectedMethod);
      }

      const [{ data: invoices, error: invError }, { data: credits, error: crError }, { data: deposits }] = await Promise.all([
        invoicesQuery,
        creditsQuery,
        depositsQuery
      ]);

      if (invError) console.error('❌ Invoices error:', invError);
      if (crError) console.error('❌ Credits error:', crError);

      console.log('📊 [Frontend] Loaded invoices for charts:', invoices?.length || 0);
      console.log('📊 [Frontend] Loaded credits for charts:', credits?.length || 0);
      console.log('📊 [Frontend] Loaded deposits for charts:', deposits?.length || 0);

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
      
      const gapAmount = netSales - approvedDepositsAmount;
      const gapAfterPending = netSales - approvedDepositsAmount - pendingDepositsAmount;

      setStats({
        totalSales: netSales,  // Use database total
        approvedDepositsAmount,
        pendingDepositsAmount,
        approvedDepositsCount: approvedDeposits.length,
        pendingDepositsCount: pendingDeposits.length,
        gapAmount,
        gapAfterPending,
      });

      // Period comparisons use loaded data (may be limited for large datasets)
      calculatePeriodComparisons(invoices || [], credits || [], deposits || []);
    } catch (err) {
      console.error('❌ Error loading dashboard data:', err);
    }
  };

  const calculatePeriodComparisons = (invoices: any[], credits: any[], deposits: any[]) => {
    const periods: PeriodComparison[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (periodType === 'monthly') {
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
          period: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
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
    } else if (periodType === 'daily') {
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
            period: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
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
        periodStart: startDate,
        periodEnd: endDate,
        sales: totalSales,
        approvedDeposits: approved,
        pendingDeposits: pending,
        gap: totalSales - approved,
        gapAfterPending: totalSales - approved - pending,
      });
    }

    setPeriodComparisons(periods);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Sales',
      value: formatCurrency(stats.totalSales),
      subtitle: 'In selected period',
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Approved Deposits',
      value: formatCurrency(stats.approvedDepositsAmount),
      subtitle: `${stats.approvedDepositsCount} deposits`,
      icon: CheckCircle,
      color: 'bg-blue-500',
    },
    {
      title: 'Pending Deposits',
      value: formatCurrency(stats.pendingDepositsAmount),
      subtitle: `${stats.pendingDepositsCount} awaiting approval`,
      icon: Clock,
      color: 'bg-yellow-500',
    },
    {
      title: 'Gap (Missing)',
      value: formatCurrency(stats.gapAmount),
      subtitle: stats.gapAfterPending < 0 
        ? `✅ Covered if pending approved` 
        : `⚠️ ${formatCurrency(stats.gapAfterPending)} still missing after pending`,
      icon: AlertTriangle,
      color: stats.gapAmount > 0 ? 'bg-red-500' : 'bg-green-500',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
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
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {statCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={index}
                className="bg-white overflow-hidden shadow rounded-lg"
              >
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
                          <div className="text-2xl font-semibold text-gray-900">
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
            );
          })}
        </div>

        {/* Chart */}
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-6">Sales vs Deposits Comparison</h3>
          {periodComparisons.length > 0 ? (
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

                {/* Bar Chart */}
                <div className="relative" style={{ height: '450px' }}>
                  {(() => {
                    // Calculate max value once for the entire chart
                    const maxValue = Math.max(...periodComparisons.map(p => 
                      Math.max(p.sales, p.approvedDeposits + p.pendingDeposits)
                    ), 1); // Minimum 1 to avoid division by zero
                    
                    const step = Math.ceil(maxValue / 5 / 1000) * 1000;
                    const yAxisMax = step * 5;

                    return (
                      <>
                        {/* Y-axis labels */}
                        <div className="absolute left-0 top-0 bottom-12 flex flex-col justify-between text-xs text-gray-500 pr-2">
                          {[5, 4, 3, 2, 1, 0].map(i => (
                            <div key={i} className="text-right w-16">
                              {formatCurrency(step * i)}
                            </div>
                          ))}
                        </div>

                        {/* Grid lines */}
                        <div className="absolute left-20 right-0 top-0 bottom-12 flex flex-col justify-between">
                          {[0, 1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="border-t border-gray-200"></div>
                          ))}
                        </div>

                        {/* Bars Container */}
                        <div className="absolute left-20 right-0 top-0 bottom-12 px-4">
                          <div className="relative h-full flex items-end justify-around gap-4">
                            {periodComparisons.map((period, idx) => {
                              const salesHeight = yAxisMax > 0 ? (period.sales / yAxisMax) * 100 : 0;
                              const approvedHeight = yAxisMax > 0 ? (period.approvedDeposits / yAxisMax) * 100 : 0;
                              const pendingHeight = yAxisMax > 0 ? (period.pendingDeposits / yAxisMax) * 100 : 0;

                              return (
                                <div key={idx} className="flex-1 flex justify-center items-end gap-1 max-w-[120px] h-full">
                                  {/* Sales Bar */}
                                  <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                    <div 
                                      className="w-full bg-green-500 rounded-t hover:bg-green-600 transition-colors cursor-pointer"
                                      style={{ height: `${salesHeight}%`, minHeight: period.sales > 0 ? '4px' : '0' }}
                                    >
                            </div>
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap z-10">
                              Sales: {formatCurrency(period.sales)}
                            </div>
                          </div>

                                  {/* Approved Bar */}
                                  <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                    <div 
                                      className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors cursor-pointer"
                                      style={{ height: `${approvedHeight}%`, minHeight: period.approvedDeposits > 0 ? '4px' : '0' }}
                                    >
                                    </div>
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap z-10">
                                      Approved: {formatCurrency(period.approvedDeposits)}
                                    </div>
                                  </div>

                                  {/* Pending Bar */}
                                  <div className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                    <div 
                                      className="w-full bg-yellow-400 rounded-t hover:bg-yellow-500 transition-colors cursor-pointer"
                                      style={{ height: `${pendingHeight}%`, minHeight: period.pendingDeposits > 0 ? '4px' : '0' }}
                                    >
                                    </div>
                                    {/* Tooltip */}
                                    {period.pendingDeposits > 0 && (
                                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap z-10">
                                        Pending: {formatCurrency(period.pendingDeposits)}
                                      </div>
                                    )}
                                  </div>

                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* X-axis labels */}
                        <div className="absolute left-20 right-0 bottom-0 flex items-center justify-around gap-4 px-4 h-12">
                    {periodComparisons.map((period, idx) => (
                      <div key={idx} className="flex-1 max-w-[120px]">
                        <div className="text-xs text-gray-600 text-center transform -rotate-0">
                          {period.period}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

                {/* Gap Summary Below Chart */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          <span className="font-bold text-gray-900">{formatCurrency(period.sales)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">✅ Approved:</span>
                          <span className="font-semibold text-blue-700">{formatCurrency(period.approvedDeposits)}</span>
                        </div>
                        {period.pendingDeposits > 0 && (
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-600">⏳ Pending:</span>
                            <span className="font-semibold text-yellow-600">{formatCurrency(period.pendingDeposits)}</span>
                          </div>
                        )}
                        
                        <div className="pt-2 mt-2 border-t-2 border-gray-300">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-700">Current Gap:</span>
                            <span className={`text-lg font-bold ${period.gap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {period.gap > 0 ? '⚠️ ' : '✅ '}{formatCurrency(Math.abs(period.gap))}
                            </span>
                          </div>
                          {period.pendingDeposits > 0 && (
                            <div className="flex justify-between items-center mt-1 text-xs">
                              <span className="text-gray-600">If pending approved:</span>
                              <span className={`font-semibold ${period.gapAfterPending > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                                {period.gapAfterPending > 0 
                                  ? `⚠️ Still ${formatCurrency(period.gapAfterPending)} missing` 
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
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400">
              No data available for selected period
            </div>
          )}
        </div>

        {/* Comparison Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Detailed Comparison Table</h3>
          </div>
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
                {periodComparisons.map((period, idx) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

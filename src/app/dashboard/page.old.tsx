'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  FileText,
  CheckCircle,
  Clock
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
      console.log('📊 [DASHBOARD] Checking authentication...');
      
      // Check if user is logged in
      const { session } = await auth.getSession();
      
      if (!session) {
        console.log('❌ [DASHBOARD] No session, redirecting to login');
        router.push('/login');
        return;
      }
      
      console.log('✅ [DASHBOARD] Session found:', session.user.email);
      console.log('📊 [DASHBOARD] Loading dashboard data...');
      
      // Set default dates (current month)
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(lastDay.toISOString().split('T')[0]);
      
      await loadPaymentMethods();
      setLoading(false);
      console.log('✅ [DASHBOARD] Data loaded successfully');
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
      // Build query filters
      let invoicesQuery = supabase
        .from('invoices')
        .select('amount_total, sale_order_date, payment_method_id, payment_methods(name_en, code)')
        .eq('state', 'posted')
        .gte('sale_order_date', startDate)
        .lte('sale_order_date', endDate);

      let depositsQuery = supabase
        .from('deposits')
        .select('net_amount, status, start_date, end_date, payment_method_id')
        .or(`and(start_date.lte.${endDate},end_date.gte.${startDate})`);

      // Filter by payment method if selected
      if (selectedMethod !== 'all') {
        invoicesQuery = invoicesQuery.eq('payment_method_id', selectedMethod);
        depositsQuery = depositsQuery.eq('payment_method_id', selectedMethod);
      }

      const [{ data: invoices }, { data: deposits }] = await Promise.all([
        invoicesQuery,
        depositsQuery
      ]);

      calculateStats(invoices || [], deposits || []);
      calculatePeriodComparisons(invoices || [], deposits || []);
    } catch (err) {
      console.error('❌ Error loading dashboard data:', err);
    }
  };

  const calculateStats = (invoices: any[], deposits: any[]) => {
    const totalSales = invoices.reduce((sum, inv) => sum + inv.amount_total, 0);
    
    const approvedDeposits = deposits.filter(d => d.status === 'approved');
    const pendingDeposits = deposits.filter(d => d.status === 'pending');
    
    const approvedDepositsAmount = approvedDeposits.reduce((sum, d) => sum + d.net_amount, 0);
    const pendingDepositsAmount = pendingDeposits.reduce((sum, d) => sum + d.net_amount, 0);
    
    const gapAmount = totalSales - approvedDepositsAmount;
    const gapAfterPending = totalSales - approvedDepositsAmount - pendingDepositsAmount;

    setStats({
      totalSales,
      approvedDepositsAmount,
      pendingDepositsAmount,
      approvedDepositsCount: approvedDeposits.length,
      pendingDepositsCount: pendingDeposits.length,
      gapAmount,
      gapAfterPending,
    });
  };

  const calculatePeriodComparisons = (invoices: any[], deposits: any[]) => {
    const periods: PeriodComparison[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (periodType === 'monthly') {
      // Group by month
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      
      while (current <= end) {
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        
        const monthSales = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate >= monthStart && invDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);

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
      // Group by day
      const current = new Date(start);
      
      while (current <= end) {
        const dayStart = new Date(current);
        const dayEnd = new Date(current);
        dayEnd.setHours(23, 59, 59, 999);
        
        const daySales = invoices
          .filter(inv => {
            const invDate = new Date(inv.sale_order_date);
            return invDate.toDateString() === current.toDateString();
          })
          .reduce((sum, inv) => sum + inv.amount_total, 0);

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
      // Custom - single period
      const totalSales = invoices.reduce((sum, inv) => sum + inv.amount_total, 0);
      
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

  const loadManualData = async () => {
    try {
      // Get invoices with payment methods and dates
      const { data: invoices } = await supabase
        .from('invoices')
        .select('amount_total, sale_order_date, payment_method_id, payment_methods(name_en)')
        .eq('state', 'posted');

      // Get credits (only linked to invoices)
      const { data: credits } = await supabase
        .from('credit_notes')
        .select('amount_total, sale_order_date')
        .eq('state', 'posted')
        .not('original_invoice_id', 'is', null);

      // Get deposits
      const { data: deposits } = await supabase
        .from('deposits')
        .select('net_amount, status, start_date, end_date, payment_method_id');

      const totalSales = invoices?.reduce((sum: number, inv: any) => sum + inv.amount_total, 0) || 0;
      const totalCredits = credits?.reduce((sum: number, cr: any) => sum + cr.amount_total, 0) || 0;
      const netSales = totalSales - totalCredits;
      
      const approvedDeposits = deposits?.filter((d: any) => d.status === 'approved').length || 0;
      const pendingDeposits = deposits?.filter((d: any) => d.status === 'pending').length || 0;
      const totalDepositsAmount = deposits?.filter((d: any) => d.status === 'approved').reduce((sum: number, d: any) => sum + d.net_amount, 0) || 0;

      setStats({
        totalSales,
        totalCredits,
        netSales,
        approvedDeposits,
        pendingDeposits,
        netAfterDeposits: netSales - totalDepositsAmount,
        totalDepositsAmount,
        invoiceCount: invoices?.length || 0,
        creditCount: credits?.length || 0,
      });

      // Prepare chart data
      prepareChartData(invoices || [], credits || [], deposits || []);
    } catch (err) {
      console.error('❌ Error in manual data loading:', err);
    }
  };

  const prepareChartData = (invoices: any[], credits: any[], deposits: any[]) => {
    // Sales by month
    const monthlyData = new Map<string, number>();
    invoices.forEach(inv => {
      const date = new Date(inv.sale_order_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyData.set(monthKey, (monthlyData.get(monthKey) || 0) + inv.amount_total);
    });
    
    const salesByMonth = Array.from(monthlyData.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6); // Last 6 months

    // Payment methods distribution
    const methodsData = new Map<string, number>();
    invoices.forEach(inv => {
      const methodName = inv.payment_methods?.name_en || 'Unknown';
      methodsData.set(methodName, (methodsData.get(methodName) || 0) + inv.amount_total);
    });
    
    const paymentMethods = Array.from(methodsData.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    // Deposits by status
    const depositsByStatus = [
      {
        status: 'Approved',
        count: deposits.filter(d => d.status === 'approved').length,
        amount: deposits.filter(d => d.status === 'approved').reduce((sum, d) => sum + d.net_amount, 0)
      },
      {
        status: 'Pending',
        count: deposits.filter(d => d.status === 'pending').length,
        amount: deposits.filter(d => d.status === 'pending').reduce((sum, d) => sum + d.net_amount, 0)
      },
      {
        status: 'Rejected',
        count: deposits.filter(d => d.status === 'rejected').length,
        amount: deposits.filter(d => d.status === 'rejected').reduce((sum, d) => sum + d.net_amount, 0)
      }
    ];

    setChartData({
      salesByMonth,
      paymentMethods,
      depositsByStatus
    });
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
      title: 'Total Invoices',
      value: formatCurrency(stats.totalSales),
      subtitle: `${stats.invoiceCount} invoices`,
      icon: DollarSign,
      color: 'bg-blue-500',
    },
    {
      title: 'Total Credits',
      value: formatCurrency(stats.totalCredits),
      subtitle: `${stats.creditCount} credits (linked)`,
      icon: TrendingDown,
      color: 'bg-red-500',
    },
    {
      title: 'Net Sales',
      value: formatCurrency(stats.netSales),
      subtitle: 'After credits deduction',
      icon: FileText,
      color: 'bg-green-500',
    },
    {
      title: 'Approved Deposits',
      value: formatCurrency(stats.totalDepositsAmount),
      subtitle: `${stats.approvedDeposits} deposits approved`,
      icon: CheckCircle,
      color: 'bg-purple-500',
    },
    {
      title: 'Net After Deposits',
      value: formatCurrency(stats.netAfterDeposits),
      subtitle: 'Final net amount',
      icon: TrendingUp,
      color: 'bg-emerald-500',
    },
    {
      title: 'Pending Deposits',
      value: stats.pendingDeposits.toString(),
      subtitle: 'Awaiting approval',
      icon: Clock,
      color: 'bg-yellow-500',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-2">Overview of your financial reconciliation</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          {statCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={index}
                className="bg-white overflow-hidden shadow rounded-lg animate-fade-in"
                style={{ animationDelay: `${index * 0.1}s` }}
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
                          {stat.subtitle && (
                            <div className="mt-1 text-xs text-gray-500">
                              {stat.subtitle}
                            </div>
                          )}
                        </dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
          {/* Sales by Month Chart */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Sales Trend (Last 6 Months)</h3>
            {chartData.salesByMonth.length > 0 ? (
              <div className="space-y-3">
                {chartData.salesByMonth.map((item, idx) => {
                  const maxAmount = Math.max(...chartData.salesByMonth.map(d => d.amount));
                  const percentage = (item.amount / maxAmount) * 100;
                  const monthName = new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                  
                  return (
                    <div key={idx}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{monthName}</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(item.amount)}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div 
                          className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400">
                No sales data available
              </div>
            )}
          </div>
          
          {/* Payment Methods Chart */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Methods Distribution</h3>
            {chartData.paymentMethods.length > 0 ? (
              <div className="space-y-3">
                {chartData.paymentMethods.map((item, idx) => {
                  const totalAmount = chartData.paymentMethods.reduce((sum, m) => sum + m.amount, 0);
                  const percentage = (item.amount / totalAmount) * 100;
                  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-red-500'];
                  
                  return (
                    <div key={idx}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.name}</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(item.amount)} ({percentage.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div 
                          className={`${colors[idx % colors.length]} h-2.5 rounded-full transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400">
                No payment methods data available
              </div>
            )}
          </div>
        </div>

        {/* Deposits Status Chart */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Deposits by Status</h3>
          {chartData.depositsByStatus.some(d => d.count > 0) ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {chartData.depositsByStatus.map((item, idx) => {
                const colors = {
                  'Approved': { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-700' },
                  'Pending': { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-700' },
                  'Rejected': { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-700' }
                };
                const color = colors[item.status as keyof typeof colors];
                
                return (
                  <div key={idx} className={`${color.bg} border-l-4 ${color.border} p-4 rounded`}>
                    <div className={`text-sm font-medium ${color.text} mb-1`}>{item.status}</div>
                    <div className="text-2xl font-bold text-gray-900">{item.count}</div>
                    <div className="text-sm text-gray-600 mt-1">{formatCurrency(item.amount)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-400">
              No deposits data available
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Set max duration to 50 seconds (Netlify free limit is 30s, but let's be safe)
export const maxDuration = 50;

export async function POST(request: NextRequest) {
  try {
    const { startDate, endDate, paymentMethodId } = await request.json();

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout

    try {
      // Fetch stats from materialized view (optimized)
      const { data: statsData, error: statsError } = await supabase
        .from('dashboard_daily_aggregations')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('payment_method_id', paymentMethodId || null)
        .limit(100); // Limit to prevent large responses

      clearTimeout(timeoutId);

      if (statsError) throw statsError;

      // Calculate totals
      const totals = {
        totalSales: statsData?.reduce((sum: number, row: any) => sum + (row.daily_sales || 0), 0) || 0,
        approvedDepositsAmount: statsData?.reduce((sum: number, row: any) => sum + (row.approved_deposits || 0), 0) || 0,
        pendingDepositsAmount: statsData?.reduce((sum: number, row: any) => sum + (row.pending_deposits || 0), 0) || 0,
        gapAmount: statsData?.reduce((sum: number, row: any) => sum + (row.gap || 0), 0) || 0,
      };

      return NextResponse.json(
        {
          success: true,
          data: {
            stats: totals,
            comparisons: statsData || [],
          },
        },
        { status: 200 }
      );
    } catch (timeoutError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Request timeout - data load took too long',
          fallback: true,
        },
        { status: 408 }
      );
    }
  } catch (error: any) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to load dashboard data',
      },
      { status: 500 }
    );
  }
}

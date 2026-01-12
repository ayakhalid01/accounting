import { supabase } from './client';
import { ShopifyImportRow, ShopifySale, ShopifyFilters } from '@/types';
import { formatDateForDB } from '@/lib/parsers/shopifyParser';

const BATCH_SIZE = 500;

/**
 * Insert Shopify sales in batches
 */
export async function insertShopifySalesBatch(
  rows: ShopifyImportRow[],
  userId: string,
  onProgress?: (processed: number, total: number) => void
): Promise<{ success: boolean; inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  
  console.log(`📤 [SHOPIFY] Starting batch insert of ${rows.length} rows`);
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    const insertData = batch.map(row => ({
      transaction_id: row.transaction_id,
      day: formatDateForDB(row.day),
      order_name: row.order_name,
      payment_gateway: row.payment_gateway,
      pos_location_name: row.pos_location_name,
      order_sales_channel: row.order_sales_channel,
      pos_register_id: row.pos_register_id,
      gross_payments: row.gross_payments,
      refunded_payments: row.refunded_payments,
      net_payments: row.net_payments,
      imported_by: userId
    }));
    
    const { error } = await supabase
      .from('shopify_sales')
      .insert(insertData);
    
    if (error) {
      console.error(`❌ [SHOPIFY] Batch insert error:`, error);
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
    
    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, rows.length), rows.length);
    }
  }
  
  console.log(`✅ [SHOPIFY] Inserted ${inserted} rows with ${errors.length} errors`);
  
  return {
    success: errors.length === 0,
    inserted,
    errors
  };
}

/**
 * Get Shopify sales with filters and pagination
 */
export async function getShopifySales(
  filters: ShopifyFilters,
  page: number = 1,
  pageSize: number = 50
): Promise<{ data: ShopifySale[]; total: number; error?: string }> {
  try {
    let query = supabase
      .from('shopify_sales')
      .select('*', { count: 'exact' });
    
    // Apply filters
    if (filters.date_from) {
      query = query.gte('day', filters.date_from);
    }
    if (filters.date_to) {
      query = query.lte('day', filters.date_to);
    }
    if (filters.payment_gateway && filters.payment_gateway !== 'all') {
      query = query.eq('payment_gateway', filters.payment_gateway);
    }
    if (filters.order_sales_channel && filters.order_sales_channel !== 'all') {
      query = query.eq('order_sales_channel', filters.order_sales_channel);
    }
    if (filters.search) {
      query = query.ilike('order_name', `%${filters.search}%`);
    }
    
    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    
    query = query
      .order('day', { ascending: false })
      .order('order_name', { ascending: true })
      .range(from, to);
    
    const { data, count, error } = await query;
    
    if (error) {
      console.error('❌ [SHOPIFY] Query error:', error);
      return { data: [], total: 0, error: error.message };
    }
    
    return {
      data: data || [],
      total: count || 0
    };
  } catch (err: any) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return { data: [], total: 0, error: err.message };
  }
}

/**
 * Get aggregated Shopify sales (grouped)
 */
export async function getShopifySalesGrouped(
  filters: ShopifyFilters,
  page: number = 1,
  pageSize: number = 50
): Promise<{ data: any[]; total: number; error?: string }> {
  try {
    // Use the view for grouped data
    let query = supabase
      .from('shopify_sales_grouped')
      .select('*', { count: 'exact' });
    
    // Apply filters
    if (filters.date_from) {
      query = query.gte('day', filters.date_from);
    }
    if (filters.date_to) {
      query = query.lte('day', filters.date_to);
    }
    if (filters.payment_gateway && filters.payment_gateway !== 'all') {
      query = query.eq('payment_gateway', filters.payment_gateway);
    }
    if (filters.order_sales_channel && filters.order_sales_channel !== 'all') {
      query = query.eq('order_sales_channel', filters.order_sales_channel);
    }
    if (filters.search) {
      query = query.ilike('order_name', `%${filters.search}%`);
    }
    
    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    
    query = query
      .order('day', { ascending: false })
      .order('order_name', { ascending: true })
      .range(from, to);
    
    const { data, count, error } = await query;
    
    if (error) {
      console.error('❌ [SHOPIFY] Grouped query error:', error);
      return { data: [], total: 0, error: error.message };
    }
    
    return {
      data: data || [],
      total: count || 0
    };
  } catch (err: any) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return { data: [], total: 0, error: err.message };
  }
}

/**
 * Get unique payment gateways from database
 */
export async function getPaymentGatewaysFromDB(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('shopify_sales')
      .select('payment_gateway')
      .order('payment_gateway');
    
    if (error) {
      console.error('❌ [SHOPIFY] Get gateways error:', error);
      return [];
    }
    
    const unique = new Set<string>();
    data?.forEach(row => {
      if (row.payment_gateway) {
        unique.add(row.payment_gateway);
      }
    });
    
    return Array.from(unique).sort();
  } catch (err) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return [];
  }
}

/**
 * Get unique order sales channels from database
 */
export async function getOrderSalesChannelsFromDB(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('shopify_sales')
      .select('order_sales_channel')
      .order('order_sales_channel');
    
    if (error) {
      console.error('❌ [SHOPIFY] Get channels error:', error);
      return [];
    }
    
    const unique = new Set<string>();
    data?.forEach(row => {
      if (row.order_sales_channel) {
        unique.add(row.order_sales_channel);
      }
    });
    
    return Array.from(unique).sort();
  } catch (err) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return [];
  }
}

/**
 * Delete all Shopify sales
 */
export async function deleteAllShopifySales(): Promise<{ success: boolean; deleted: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('delete_all_shopify_sales');
    
    if (error) {
      console.error('❌ [SHOPIFY] Delete all error:', error);
      return { success: false, deleted: 0, error: error.message };
    }
    
    const deleted = data?.[0]?.deleted_count || 0;
    console.log(`✅ [SHOPIFY] Deleted ${deleted} rows`);
    
    return { success: true, deleted };
  } catch (err: any) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return { success: false, deleted: 0, error: err.message };
  }
}

/**
 * Get Shopify sales statistics
 */
export async function getShopifySalesStats(filters: ShopifyFilters): Promise<{
  totalRecords: number;
  totalGross: number;
  totalRefunded: number;
  totalNet: number;
}> {
  try {
    let query = supabase
      .from('shopify_sales')
      .select('gross_payments, refunded_payments, net_payments');
    
    // Apply filters
    if (filters.date_from) {
      query = query.gte('day', filters.date_from);
    }
    if (filters.date_to) {
      query = query.lte('day', filters.date_to);
    }
    if (filters.payment_gateway && filters.payment_gateway !== 'all') {
      query = query.eq('payment_gateway', filters.payment_gateway);
    }
    if (filters.order_sales_channel && filters.order_sales_channel !== 'all') {
      query = query.eq('order_sales_channel', filters.order_sales_channel);
    }
    if (filters.search) {
      query = query.ilike('order_name', `%${filters.search}%`);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('❌ [SHOPIFY] Stats error:', error);
      return { totalRecords: 0, totalGross: 0, totalRefunded: 0, totalNet: 0 };
    }
    
    const stats = {
      totalRecords: data?.length || 0,
      totalGross: 0,
      totalRefunded: 0,
      totalNet: 0
    };
    
    data?.forEach(row => {
      stats.totalGross += row.gross_payments || 0;
      stats.totalRefunded += row.refunded_payments || 0;
      stats.totalNet += row.net_payments || 0;
    });
    
    return stats;
  } catch (err) {
    console.error('❌ [SHOPIFY] Exception:', err);
    return { totalRecords: 0, totalGross: 0, totalRefunded: 0, totalNet: 0 };
  }
}

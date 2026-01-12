import * as XLSX from 'xlsx';
import { ShopifyImportRow } from '@/types';

/**
 * Parse date from MM/DD/YYYY to DD/MM/YYYY format
 */
export function convertShopifyDate(dateStr: string): string {
  if (!dateStr) return '';
  
  // Handle different date formats
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    // Assuming MM/DD/YYYY format from Shopify
    const [month, day, year] = parts;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  
  return dateStr;
}

/**
 * Parse date string to Date object (handles multiple formats)
 */
export function parseShopifyDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const str = String(dateStr).trim();
  
  // Handle YYYY-MM-DD format (ISO format, already correct for DB)
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = str.split('-').map(p => parseInt(p, 10));
    return new Date(year, month - 1, day);
  }
  
  // Handle MM/DD/YYYY format (US format from Shopify)
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts.map(p => parseInt(p, 10));
      return new Date(year, month - 1, day);
    }
  }
  
  // Handle DD-MM-YYYY or DD/MM/YYYY (if day > 12, assume DD/MM/YYYY)
  // Try parsing as Date object
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return null;
}

/**
 * Format Date to YYYY-MM-DD for database
 */
export function formatDateForDB(dateStr: string): string {
  if (!dateStr) return '';
  
  const str = String(dateStr).trim();
  
  // If already in YYYY-MM-DD format, return as-is
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return str;
  }
  
  const date = parseShopifyDate(str);
  if (!date || isNaN(date.getTime())) return '';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Parse numeric value from various formats
 */
function parseNumericValue(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  // Remove currency symbols, commas, and extra spaces
  const cleaned = String(value).replace(/[,$\s]/g, '').trim();
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse Shopify Excel/CSV file
 */
export async function parseShopifyFile(file: File, headerRowIndex: number = 0): Promise<{
  columns: string[];
  rows: ShopifyImportRow[];
  rawRows: Record<string, any>[];
  rowCount: number;
}> {
  console.log(`📁 [SHOPIFY_PARSER] Parsing file: ${file.name}`);
  
  const buffer = await file.arrayBuffer();
  
  let workbook;
  if (file.name.endsWith('.csv')) {
    const text = new TextDecoder().decode(buffer);
    workbook = XLSX.read(text, { type: 'string', raw: true });
  } else {
    workbook = XLSX.read(buffer, { type: 'array' });
  }
  
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('No sheets found in file');
  }
  
  const sheet = workbook.Sheets[sheetName];
  
  // Parse to JSON with header row
  const jsonData = XLSX.utils.sheet_to_json(sheet, { 
    header: 1,
    defval: ''
  }) as any[][];
  
  if (jsonData.length <= headerRowIndex) {
    throw new Error('File has insufficient rows');
  }
  
  // Get headers from specified row
  const headers = jsonData[headerRowIndex].map(h => String(h).trim());
  console.log(`🏷️ [SHOPIFY_PARSER] Headers found:`, headers);
  
  // Map headers to standard column names
  const columnMapping: Record<string, string> = {
    'Transaction ID': 'transaction_id',
    'Day': 'day',
    'Order name': 'order_name',
    'Payment gateway': 'payment_gateway',
    'POS location name': 'pos_location_name',
    'Order sales channel': 'order_sales_channel',
    'POS register ID': 'pos_register_id',
    'Gross payments': 'gross_payments',
    'Refunded payments': 'refunded_payments',
    'Net payments': 'net_payments'
  };
  
  // Find column indices
  const columnIndices: Record<string, number> = {};
  headers.forEach((header, idx) => {
    const mappedName = columnMapping[header];
    if (mappedName) {
      columnIndices[mappedName] = idx;
    }
  });
  
  console.log(`🔍 [SHOPIFY_PARSER] Column indices:`, columnIndices);
  
  // Parse data rows
  const rawRows: Record<string, any>[] = [];
  const rows: ShopifyImportRow[] = [];
  
  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;
    
    // Create raw row object
    const rawRow: Record<string, any> = {};
    headers.forEach((header, idx) => {
      rawRow[header] = row[idx];
    });
    rawRows.push(rawRow);
    
    // Get values using column mapping
    const dayValue = row[columnIndices['day']];
    const orderName = row[columnIndices['order_name']];
    const paymentGateway = row[columnIndices['payment_gateway']];
    
    // Skip rows without essential data
    if (!orderName || !paymentGateway) continue;
    
    const importRow: ShopifyImportRow = {
      transaction_id: row[columnIndices['transaction_id']] ? String(row[columnIndices['transaction_id']]) : undefined,
      day: String(dayValue || ''),
      order_name: String(orderName),
      payment_gateway: String(paymentGateway).trim(),
      pos_location_name: row[columnIndices['pos_location_name']] ? String(row[columnIndices['pos_location_name']]) : undefined,
      order_sales_channel: row[columnIndices['order_sales_channel']] ? String(row[columnIndices['order_sales_channel']]) : undefined,
      pos_register_id: row[columnIndices['pos_register_id']] ? String(row[columnIndices['pos_register_id']]) : undefined,
      gross_payments: parseNumericValue(row[columnIndices['gross_payments']]),
      refunded_payments: parseNumericValue(row[columnIndices['refunded_payments']]),
      net_payments: parseNumericValue(row[columnIndices['net_payments']])
    };
    
    rows.push(importRow);
  }
  
  console.log(`✅ [SHOPIFY_PARSER] Parsed ${rows.length} valid rows from ${rawRows.length} total rows`);
  
  return {
    columns: headers,
    rows,
    rawRows,
    rowCount: rows.length
  };
}

/**
 * Group Shopify sales by day, order name, and payment gateway
 */
export function groupShopifySales(rows: ShopifyImportRow[]): Map<string, ShopifyImportRow> {
  const grouped = new Map<string, ShopifyImportRow>();
  
  rows.forEach(row => {
    const key = `${row.day}|${row.order_name}|${row.payment_gateway}`;
    
    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.gross_payments += row.gross_payments;
      existing.refunded_payments += row.refunded_payments;
      existing.net_payments += row.net_payments;
    } else {
      grouped.set(key, { ...row });
    }
  });
  
  console.log(`📊 [SHOPIFY_PARSER] Grouped ${rows.length} rows into ${grouped.size} unique groups`);
  
  return grouped;
}

/**
 * Get unique payment gateways from rows
 */
export function getUniquePaymentGateways(rows: ShopifyImportRow[]): string[] {
  const gateways = new Set<string>();
  rows.forEach(row => {
    if (row.payment_gateway) {
      gateways.add(row.payment_gateway.trim());
    }
  });
  return Array.from(gateways).sort();
}

/**
 * Get unique order sales channels from rows
 */
export function getUniqueOrderSalesChannels(rows: ShopifyImportRow[]): string[] {
  const channels = new Set<string>();
  rows.forEach(row => {
    if (row.order_sales_channel) {
      channels.add(row.order_sales_channel.trim());
    }
  });
  return Array.from(channels).sort();
}

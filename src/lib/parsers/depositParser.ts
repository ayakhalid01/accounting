import * as XLSX from 'xlsx';
import { DepositFileData } from '@/types';

/**
 * Parse Excel or CSV file and extract columns and data
 */
export async function parseDepositFile(file: File): Promise<DepositFileData> {
  try {
    const buffer = await file.arrayBuffer();
    
    let workbook;
    if (file.name.endsWith('.csv')) {
      // Parse CSV
      const text = new TextDecoder().decode(buffer);
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      // Parse Excel
      workbook = XLSX.read(buffer, { type: 'array' });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('No sheets found in file');
    }

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

    if (jsonData.length === 0) {
      throw new Error('No data found in file');
    }

    const columns = Object.keys(jsonData[0] || {});

    return {
      columns,
      rows: jsonData,
      rowCount: jsonData.length
    };
  } catch (error) {
    console.error('❌ [FILE_PARSER] Error parsing file:', error);
    throw new Error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract distinct values from a column
 */
export function getDistinctValues(rows: Record<string, any>[], columnName: string): string[] {
  const values = new Set<string>();
  
  rows.forEach(row => {
    const value = row[columnName];
    if (value !== null && value !== undefined && value !== '') {
      values.add(String(value).trim());
    }
  });

  return Array.from(values).sort();
}

/**
 * Filter rows based on column values
 */
export function filterRowsByColumn(
  rows: Record<string, any>[],
  columnName: string | undefined,
  values: string[] | undefined
): Record<string, any>[] {
  // If no column or no values selected, apply strict filter:
  // - If columnName exists but values is empty/undefined: return no rows (filter is defined but empty)
  // - If columnName doesn't exist: return all rows (no filter configured)
  
  if (!columnName) {
    // No filter column configured → include all rows
    return rows;
  }

  // Filter column IS configured
  if (!values || values.length === 0) {
    // Filter column configured but NO values selected → return empty (exclude all)
    return [];
  }

  // Filter column configured AND values selected → return matching rows
  return rows.filter(row => {
    const rowValue = String(row[columnName] || '').trim();
    return values.includes(rowValue);
  });
}

/**
 * Sum numeric column
 */
export function sumColumn(rows: Record<string, any>[], columnName: string): number {
  return rows.reduce((sum, row) => {
    const value = parseFloat(String(row[columnName] || 0));
    return sum + (isNaN(value) ? 0 : value);
  }, 0);
}

/**
 * Calculate deposit totals
 */
export function calculateDepositTotals(
  rows: Record<string, any>[],
  amountColumnName: string,
  refundColumnName?: string,
  taxMethod?: string,
  taxValue?: number,
  taxColumnName?: string
) {
  const totalAmount = sumColumn(rows, amountColumnName);
  const totalRefunds = refundColumnName ? sumColumn(rows, refundColumnName) : 0;
  const netAmount = totalAmount - totalRefunds;

  let taxAmount = 0;

  if (taxMethod === 'fixed_percent' && taxValue) {
    taxAmount = netAmount * (taxValue / 100);
  } else if (taxMethod === 'fixed_amount' && taxValue) {
    taxAmount = taxValue;
  } else if (taxMethod === 'column_based' && taxColumnName) {
    taxAmount = sumColumn(rows, taxColumnName);
  }

  const finalAmount = netAmount + taxAmount;

  return {
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalRefunds: Math.round(totalRefunds * 100) / 100,
    netAmount: Math.round(netAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    finalAmount: Math.round(finalAmount * 100) / 100,
    rowsAfterFilter: rows.length
  };
}

/**
 * Check if column is numeric
 */
export function isNumericColumn(rows: Record<string, any>[], columnName: string): boolean {
  if (rows.length === 0) return false;

  // Check first 10 rows
  const checkRows = rows.slice(0, Math.min(10, rows.length));
  
  return checkRows.every(row => {
    const value = row[columnName];
    if (value === null || value === undefined || value === '') return true; // Allow empty values
    return !isNaN(parseFloat(String(value)));
  });
}

import * as XLSX from 'xlsx';
import { DepositFileData } from '@/types';

/**
 * Parse Excel or CSV file and extract columns and data
 */
export async function parseDepositFile(file: File, headerRowIndex: number = 0): Promise<DepositFileData> {
  try {
    console.log(`📁 [FILE_PARSER] Starting to parse file: ${file.name} (${file.size} bytes, type: ${file.type}) with header row index: ${headerRowIndex}`);
    
    const buffer = await file.arrayBuffer();
    
    let workbook;
    let fileType = 'unknown';
    
    if (file.name.endsWith('.csv')) {
      fileType = 'CSV';
      console.log(`📄 [FILE_PARSER] Detected CSV file, parsing as text...`);
      // Parse CSV
      const text = new TextDecoder().decode(buffer);
      workbook = XLSX.read(text, { type: 'string' });
    } else if (file.name.endsWith('.xlsx')) {
      fileType = 'Excel (.xlsx)';
      console.log(`📊 [FILE_PARSER] Detected Excel .xlsx file, parsing as binary...`);
      // Parse Excel
      workbook = XLSX.read(buffer, { type: 'array' });
    } else if (file.name.endsWith('.xls')) {
      fileType = 'Excel (.xls)';
      console.log(`📊 [FILE_PARSER] Detected Excel .xls file, parsing as binary...`);
      // Parse Excel
      workbook = XLSX.read(buffer, { type: 'array' });
    } else {
      fileType = 'Excel (other)';
      console.log(`📊 [FILE_PARSER] Detected Excel file (unknown extension), parsing as binary...`);
      // Parse Excel
      workbook = XLSX.read(buffer, { type: 'array' });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('No sheets found in file');
    }

    console.log(`📋 [FILE_PARSER] Processing sheet: "${sheetName}" (${workbook.SheetNames.length} total sheets)`);

    const sheet = workbook.Sheets[sheetName];
    
    // Parse with specified header row index
    let jsonData: Record<string, any>[];
    if (headerRowIndex === 0) {
      // Use first row as headers (default behavior)
      jsonData = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];
      console.log(`📊 [FILE_PARSER] Parsed ${jsonData.length} rows from ${fileType} file using row 0 as headers`);
    } else {
      // Skip rows until the specified header row
      jsonData = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex }) as Record<string, any>[];
      console.log(`📊 [FILE_PARSER] Parsed ${jsonData.length} rows from ${fileType} file using row ${headerRowIndex} as headers`);
    }

    if (jsonData.length === 0) {
      throw new Error('No data found in file');
    }

    let columns = Object.keys(jsonData[0] || {});
    console.log(`🏷️ [FILE_PARSER] Initial columns detected: ${columns.length} (${columns.join(', ')})`);
    
    // Filter out XLSX-generated empty column names like "__EMPTY", "_EMPTY", "__EMPTY_1", "_EMPTY_1", etc.
    const filteredColumns = columns.filter(col => !col.startsWith('__EMPTY') && !col.startsWith('_EMPTY'));
    console.log(`🧹 [FILE_PARSER] Filtered out ${columns.length - filteredColumns.length} empty columns, remaining: ${filteredColumns.length} (${filteredColumns.join(', ')})`);

    console.log(`✅ [FILE_PARSER] Successfully parsed ${fileType} file: ${filteredColumns.length} columns, ${jsonData.length} rows`);

    return {
      columns: filteredColumns,
      rows: jsonData,
      rowCount: jsonData.length
    };
  } catch (error) {
    console.error(`❌ [FILE_PARSER] Error parsing file ${file?.name || 'unknown'}:`, error);
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
    const value = row[columnName];
    // Handle both string and numeric values
    const numericValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
    return sum + (isNaN(numericValue) ? 0 : numericValue);
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
  // Convert amount and refund columns to numbers
  let processedRows = convertAmountColumnToNumbers(rows, amountColumnName, 'Amount');
  if (refundColumnName) {
    processedRows = convertAmountColumnToNumbers(processedRows, refundColumnName, 'Refund');
  }
  if (taxColumnName && (taxMethod === 'column_based')) {
    processedRows = convertAmountColumnToNumbers(processedRows, taxColumnName, 'Tax');
  }

  const totalAmount = sumColumn(processedRows, amountColumnName);
  const totalRefunds = refundColumnName ? sumColumn(processedRows, refundColumnName) : 0;
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
 * Convert amount column values to numbers with logging
 */
export function convertAmountColumnToNumbers(rows: Record<string, any>[], columnName: string, label: string = 'Amount'): Record<string, any>[] {
  console.log(`🔢 [AMOUNT_CONVERT] Converting ${label} column "${columnName}" to numbers for ${rows.length} rows`);
  
  let convertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  const convertedRows = rows.map((row, index) => {
    const originalValue = row[columnName];
    const stringValue = String(originalValue || '').trim();
    
    if (stringValue === '' || stringValue === '0') {
      // Empty or zero values remain as 0
      row[columnName] = 0;
      skippedCount++;
      return row;
    }
    
    const numericValue = parseFloat(stringValue);
    
    if (isNaN(numericValue)) {
      console.warn(`⚠️ [AMOUNT_CONVERT] Row ${index + 1}: Invalid ${label} value "${originalValue}" -> 0`);
      row[columnName] = 0;
      errorCount++;
    } else {
      if (originalValue !== numericValue) {
        console.log(`🔄 [AMOUNT_CONVERT] Row ${index + 1}: "${originalValue}" -> ${numericValue}`);
      }
      row[columnName] = numericValue;
      convertedCount++;
    }
    
    return row;
  });
  
  console.log(`✅ [AMOUNT_CONVERT] ${label} conversion complete: ${convertedCount} converted, ${skippedCount} skipped, ${errorCount} errors`);
  
  return convertedRows;
}

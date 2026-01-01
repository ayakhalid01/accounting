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
      // Parse CSV with raw option to preserve exact casing
      const text = new TextDecoder().decode(buffer);
      workbook = XLSX.read(text, { type: 'string', raw: true });
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
    
    // Check if sheet has any data
    if (!sheet['!ref']) {
      throw new Error('Sheet appears to be empty or has no data range');
    }
    
    // Parse with specified header row index and preserve original display formatting
    let jsonData: Record<string, any>[];
    
    // Get formatted values by processing cells individually (works for any headerRowIndex)
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headers: string[] = [];

    console.log(`📊 [FILE_PARSER] Sheet range: ${sheet['!ref']} (rows: ${range.e.r - range.s.r + 1}, cols: ${range.e.c - range.s.c + 1})`);
    
    // Validate headerRowIndex is within sheet bounds
    if (headerRowIndex > range.e.r) {
      console.warn(`⚠️ [FILE_PARSER] Header row index ${headerRowIndex} exceeds sheet range, using row 0`);
      headerRowIndex = 0;
    }

    // Get headers from specified header row, skipping empty columns at the beginning
    let startCol = range.s.c;
    
    // Find the first non-empty column in the header row
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
      const cell = sheet[cellAddress];
      if (cell && cell.v !== undefined && String(cell.v).trim() !== '') {
        startCol = col;
        console.log(`🎯 [FILE_PARSER] Found first non-empty header at column ${col} (skipping ${col - range.s.c} empty columns)`);
        break;
      }
    }
    
    // Now collect headers starting from the first non-empty column
    for (let col = startCol; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
      const cell = sheet[cellAddress];
      if (cell && cell.v !== undefined) {
        const headerName = String(cell.v).trim();
        if (headerName !== '') {
          headers.push(headerName);
        } else {
          // Include empty header cells that come after non-empty ones
          headers.push(`Column ${headers.length + 1}`);
        }
      } else {
        headers.push(`Column ${headers.length + 1}`);
      }
    }

    console.log(`🏷️ [FILE_PARSER] Found ${headers.length} headers at row ${headerRowIndex}: ${headers.join(', ')}`);

    // If no headers found, try to use default column names or fallback to row 0
    if (headers.length === 0) {
      console.warn(`⚠️ [FILE_PARSER] No headers found at row ${headerRowIndex}, trying row 0...`);
      startCol = range.s.c;
      
      // Find first non-empty in row 0 as well
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = sheet[cellAddress];
        if (cell && cell.v !== undefined && String(cell.v).trim() !== '') {
          startCol = col;
          console.log(`🎯 [FILE_PARSER] Fallback: Found first non-empty header at column ${col} in row 0`);
          break;
        }
      }
      
      for (let col = startCol; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = sheet[cellAddress];
        if (cell && cell.v !== undefined) {
          headers.push(String(cell.v));
        }
      }
      
      if (headers.length === 0) {
        // Generate default column names
        const numCols = range.e.c - startCol + 1;
        headers.push(...Array.from({ length: numCols }, (_, i) => `Column ${i + 1}`));
        console.warn(`⚠️ [FILE_PARSER] Using default column names starting from column ${startCol}: ${headers.join(', ')}`);
      } else {
        console.log(`✅ [FILE_PARSER] Fallback to row 0 headers starting from column ${startCol}: ${headers.join(', ')}`);
      }
    }

    // Parse data rows starting from the row after header
    const dataRows: Record<string, any>[] = [];
    for (let row = headerRowIndex + 1; row <= range.e.r; row++) {
      const rowData: Record<string, any> = {};
      let hasData = false;

      // Start from the same startCol as headers to maintain alignment
      for (let col = 0; col < headers.length; col++) {
        const actualCol = startCol + col; // Map header index to actual column index
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: actualCol });
        const cell = sheet[cellAddress];

        if (cell) {
          // Preserve original formatting - prioritize raw value for exact representation
          let cellValue: any;
          
          // For boolean cells, preserve the formatted display (TRUE/FALSE) if available
          if (cell.t === 'b' && cell.w !== undefined) {
            cellValue = cell.w; // Use formatted boolean display (TRUE/FALSE)
          } else if (cell.v !== undefined) {
            cellValue = cell.v; // Use raw value for other types
          } else if (cell.w !== undefined) {
            cellValue = cell.w; // Fallback to formatted value
          } else {
            cellValue = '';
          }
          
          // Convert to string while preserving original casing
          rowData[headers[col]] = cellValue === null || cellValue === undefined ? '' : String(cellValue);
          
          if (rowData[headers[col]] !== '') {
            hasData = true;
          }
        } else {
          rowData[headers[col]] = '';
        }
      }

      if (hasData) {
        dataRows.push(rowData);
      }
    }

    jsonData = dataRows;
    console.log(`📊 [FILE_PARSER] Parsed ${jsonData.length} data rows from ${fileType} file (header at row ${headerRowIndex})`);
    
    // If no data rows found but we have headers, it might be that headerRowIndex is too high
    if (jsonData.length === 0 && headers.length > 0) {
      console.warn(`⚠️ [FILE_PARSER] No data rows found, but headers exist. This might indicate headerRowIndex (${headerRowIndex}) is set too high.`);
    }

    if (jsonData.length === 0) {
      console.warn(`⚠️ [FILE_PARSER] No data rows found after header row ${headerRowIndex}`);
      console.warn(`📊 [FILE_PARSER] Sheet details: range=${sheet['!ref']}, headers=${headers.length}, headerRowIndex=${headerRowIndex}`);
      throw new Error(`No data found in file after header row. Please check that your header row index (${headerRowIndex}) is correct and there are data rows below it.`);
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
  const rawValues = new Set<any>();

  rows.forEach(row => {
    const value = row[columnName];
    rawValues.add(value); // Track raw values for debugging

    // Preserve the exact string representation as it appears in the parsed data
    if (value !== null && value !== undefined) {
      const stringValue = String(value).trim();
      if (stringValue !== '') {
        values.add(stringValue);
      }
    }
  });

  // Convert to array and sort alphabetically to preserve original appearance order
  const result = Array.from(values).sort((a, b) => a.localeCompare(b));

  console.log(`🔍 [DISTINCT_VALUES] Column "${columnName}": ${rawValues.size} raw values, ${values.size} distinct string values`);
  console.log(`🔍 [DISTINCT_VALUES] Raw values sample:`, Array.from(rawValues).slice(0, 5));
  console.log(`🔍 [DISTINCT_VALUES] String values sample:`, result.slice(0, 10));

  return result;
}

/**
 * Check if a column contains mostly numeric data
 */
export function isNumericColumn(rows: Record<string, any>[], columnName: string): boolean {
  if (!rows.length) return false;

  let numericCount = 0;
  let totalCount = 0;

  // Check first 10 rows or all rows if less than 10
  const sampleSize = Math.min(10, rows.length);

  for (let i = 0; i < sampleSize; i++) {
    const value = rows[i][columnName];
    if (value != null && value !== '') {
      totalCount++;
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue)) {
        numericCount++;
      }
    }
  }

  // Consider column numeric if at least 70% of non-empty values are numeric
  return totalCount > 0 && (numericCount / totalCount) >= 0.7;
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
    processedRows = convertAmountColumnToNumbers(processedRows, refundColumnName, 'Refund'); // Normal comma parsing
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
    
    // Parse number with comma handling
    const numericValue = parseNumberWithCommas(stringValue);
    
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

/**
 * Parse number strings that may contain commas as thousands separators
 */
function parseNumberWithCommas(value: string): number {
  if (!value || typeof value !== 'string') {
    return NaN;
  }

  // Remove all spaces and handle various formats
  let cleanValue = value.replace(/\s/g, '');

  // Check for negative signs at the beginning or end
  const isNegativeAtStart = cleanValue.startsWith('-');
  const isNegativeAtEnd = cleanValue.endsWith('-');

  // Remove negative signs from both ends
  if (isNegativeAtStart) {
    cleanValue = cleanValue.slice(1); // Remove leading minus sign
  }
  if (isNegativeAtEnd) {
    cleanValue = cleanValue.slice(0, -1); // Remove trailing minus sign
  }

  // Handle different number formats:
  // 1. "384,944.49" (comma as thousands separator, dot as decimal)
  // 2. "384.944,49" (dot as thousands separator, comma as decimal - European style)
  // 3. "384944.49" (no separators)
  // 4. "384944,49" (comma as decimal)

  // Count dots and commas
  const dotCount = (cleanValue.match(/\./g) || []).length;
  const commaCount = (cleanValue.match(/,/g) || []).length;

  let result: number;

  if (dotCount === 1 && commaCount === 0) {
    // Standard format: "384944.49" or "384,944.49"
    cleanValue = cleanValue.replace(/,/g, '');
    result = parseFloat(cleanValue);
  } else if (commaCount === 1 && dotCount === 0) {
    // European format: "384944,49" -> convert to "384944.49"
    cleanValue = cleanValue.replace(/,/g, '.');
    result = parseFloat(cleanValue);
  } else if (dotCount === 1 && commaCount >= 1) {
    // Mixed format like "384,944.49" - comma is thousands separator
    cleanValue = cleanValue.replace(/,/g, '');
    result = parseFloat(cleanValue);
  } else if (commaCount === 1 && dotCount >= 1) {
    // European mixed format like "384.944,49" - dot is thousands separator, comma is decimal
    cleanValue = cleanValue.replace(/\./g, '').replace(/,/g, '.');
    result = parseFloat(cleanValue);
  } else {
    // Remove all separators and try to parse
    cleanValue = cleanValue.replace(/[,]/g, '');
    result = parseFloat(cleanValue);
  }

  // Apply negative sign if it was present at start or end
  if ((isNegativeAtStart || isNegativeAtEnd) && !isNaN(result)) {
    result = -result;
  }

  return isNaN(result) ? NaN : result;
}


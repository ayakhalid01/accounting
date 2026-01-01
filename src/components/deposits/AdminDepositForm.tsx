'use client';

import { useState, useEffect } from 'react';
import { supabase, storage } from '@/lib/supabase/client';
import { loadDepositSettings, saveDeposit, saveDepositSettings } from '@/lib/supabase/deposits';
import {
  parseDepositFile,
  getDistinctValues,
  filterRowsByColumn,
  calculateDepositTotals,
  isNumericColumn,
  convertAmountColumnToNumbers
} from '@/lib/parsers/depositParser';
import { DepositFileData, DepositSettings, PaymentMethod } from '@/types';
import { Upload, Calendar, DollarSign, Settings, Check, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';

type AdminDepositPhase = 'initial' | 'configured' | 'processed';

interface ColumnSelectState {
  filterColumn?: string;
  filterValues?: string[];
  amountColumn?: string;
  refundColumn?: string;
}

interface AdminDepositFormProps {
  onClose: () => void;
  onSuccess: () => void;
  currentUserId: string;
}

export default function AdminDepositForm({ onClose, onSuccess, currentUserId }: AdminDepositFormProps) {
  const [loading, setLoading] = useState(true);
  
  // Initial inputs
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  // Support grouping multiple payment methods (ordered) - first is base method
  const [methodGroup, setMethodGroup] = useState<Array<{payment_method_id: string; name_en: string}>>([]);
  const [methodToAdd, setMethodToAdd] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedByEmail, setUploadedByEmail] = useState<string>('');
  
  // File data
  const [fileData, setFileData] = useState<DepositFileData | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  
  // Phase management
  const [phase, setPhase] = useState<AdminDepositPhase>('initial');
  
  // Column selection
  const [columns, setColumns] = useState<ColumnSelectState>({});
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});
  const [filterSearchTerm, setFilterSearchTerm] = useState<string>('');
  
  // Calculations
  const [calculation, setCalculation] = useState<any>(null);
  const [settings, setSettings] = useState<DepositSettings | null>(null);
  const [processing, setProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Tax override state
  const [taxOverride, setTaxOverride] = useState<{
    useOverride: boolean;
    method?: 'fixed_percent' | 'fixed_amount' | 'column_based';
    value?: number;
    columnName?: string;
  }>({
    useOverride: false
  });
  
  // Load payment methods
  useEffect(() => {
    const loadPaymentMethods = async () => {
      try {
        const { data, error } = await supabase
          .from('payment_methods')
          .select('*')
          .order('name_en');
        
        if (error) throw error;
        setPaymentMethods(data || []);
      } catch (err) {
        console.error('Error loading payment methods:', err);
        setUploadError('Failed to load payment methods');
      } finally {
        setLoading(false);
      }
    };
    
    loadPaymentMethods();
  }, []);
  
  // Load settings when payment method changes
  useEffect(() => {
    const loadSettings = async () => {
      if (!selectedPaymentMethod) return;
      
      console.log('🔄 Loading settings for payment method:', selectedPaymentMethod);
      const loadedSettings = await loadDepositSettings(selectedPaymentMethod);
      console.log('✅ Settings loaded:', loadedSettings);
      console.log('   - tax_enabled:', loadedSettings?.tax_enabled);
      console.log('   - tax_method:', loadedSettings?.tax_method);
      console.log('   - tax_value:', loadedSettings?.tax_value);
      setSettings(loadedSettings);
      
      // Auto-fill columns from settings
      if (loadedSettings) {
        const autoFillColumns: any = {};
        if (loadedSettings.amount_column_name) {
          autoFillColumns.amountColumn = loadedSettings.amount_column_name;
        }
        if (loadedSettings.refund_column_name) {
          autoFillColumns.refundColumn = loadedSettings.refund_column_name;
        }
        if (loadedSettings.filter_column_name) {
          autoFillColumns.filterColumn = loadedSettings.filter_column_name;
        }
        if (loadedSettings.filter_include_values) {
          autoFillColumns.filterValues = loadedSettings.filter_include_values || [];
        }
        setColumns(autoFillColumns);
        
        // Auto-fill tax override if tax is configured
        if (loadedSettings.tax_enabled) {
          console.log('🔄 Auto-filling tax override from settings...');
          
          // Map database method names to UI names
          const methodMap: any = {
            'percentage': 'fixed_percent',
            'fixed_amount': 'fixed_amount',
            'column': 'column_based',
            'no_tax': 'none'
          };
          
          const uiMethod = methodMap[loadedSettings.tax_method || ''] || 'none';
          
          setTaxOverride({
            useOverride: false, // Use settings, not override
            method: uiMethod as any,
            value: loadedSettings.tax_value || undefined,
            columnName: loadedSettings.tax_column_name || undefined
          });
        }
      } else {
        // Reset form if no settings
        setColumns({});
        setTaxOverride({ useOverride: false });
      }
      
      setFile(null);
      setFileData(null);
      setUploadError('');
      setPhase('initial');
    };
    
    loadSettings();
  }, [selectedPaymentMethod]);

  // Monitor tax override changes
  useEffect(() => {
    console.log('📌 Tax Override updated:', taxOverride);
  }, [taxOverride]);
  
  // Handle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setUploadError('');
    
    try {
      const data = await parseDepositFile(selectedFile);
      setFileData(data);
      
      // Pre-fill from settings if available
      if (settings) {
        const prefilledColumns: ColumnSelectState = {
          filterColumn: settings.filter_column_name || '',
          filterValues: settings.filter_include_values || [],
          amountColumn: settings.amount_column_name || '',
          refundColumn: settings.refund_column_name || ''
        };
        setColumns(prefilledColumns);
        
        // Extract distinct values for filter column
        if (settings.filter_column_name && data.rows.length > 0) {
          const values = getDistinctValues(data.rows, settings.filter_column_name);
          setDistinctValues((prev) => ({
            ...prev,
            [settings.filter_column_name!]: values
          }));
        }
      }
      
      setPhase('configured');
    } catch (err: any) {
      setUploadError(err.message || 'Failed to parse file');
    }
  };
  
  // Handle column selection
  const handleColumnChange = (columnType: 'filterColumn' | 'amountColumn' | 'refundColumn', value: string) => {
    setColumns((prev) => ({
      ...prev,
      [columnType]: value
    }));
    
    // Extract distinct values for filter column
    if (columnType === 'filterColumn' && fileData && value) {
      const values = getDistinctValues(fileData.rows, value);
      setDistinctValues((prev) => ({
        ...prev,
        [value]: values
      }));
      setColumns((prev) => ({
        ...prev,
        filterValues: []
      }));
    }
  };
  
  // Handle filter value selection
  const handleFilterValueToggle = (value: string) => {
    setColumns((prev) => {
      const filterValues = prev.filterValues || [];
      const newValues = filterValues.includes(value)
        ? filterValues.filter((v) => v !== value)
        : [...filterValues, value];
      return {
        ...prev,
        filterValues: newValues
      };
    });
  };
  
  // Calculate deposit with tax
  const handleCalculate = () => {
    if (!fileData || !columns.amountColumn) {
      setUploadError('Please select all required columns');
      return;
    }
    
    try {
      let filteredRows = fileData.rows;
      
      // Skip rows where all selected columns (amount, refund, filter) are empty
      const initialRowCount = filteredRows.length;
      filteredRows = filteredRows.filter((row: any) => {
        const amountValue = row[columns.amountColumn!];
        const refundValue = columns.refundColumn ? row[columns.refundColumn] : null;
        const filterValue = columns.filterColumn ? row[columns.filterColumn] : null;
        
        // Check if all selected columns are empty (null, undefined, or empty string)
        const isAmountEmpty = amountValue == null || amountValue === '';
        const isRefundEmpty = refundValue == null || refundValue === '';
        const isFilterEmpty = filterValue == null || filterValue === '';
        
        // Keep row only if at least one selected column has a value
        return !(isAmountEmpty && isRefundEmpty && isFilterEmpty);
      });
      const skippedRows = initialRowCount - filteredRows.length;
      if (skippedRows > 0) {
        console.log(`🗑️ [DEPOSIT_CALC] Skipped ${skippedRows} empty rows, ${filteredRows.length} rows remaining`);
      }
      
      // Always apply filter if column is selected (even if values are empty)
      if (columns.filterColumn) {
        filteredRows = filterRowsByColumn(filteredRows, columns.filterColumn, columns.filterValues);
      }
      
      // DEBUG: Log settings
      console.log('=== ADMIN DEPOSIT FORM CALCULATION ===');
      console.log('Settings loaded:', settings);
      console.log('Settings tax_enabled:', settings?.tax_enabled);
      console.log('Tax override:', taxOverride);
      
      // Determine which tax config to use
      const taxConfig = taxOverride.useOverride 
        ? {
            method: taxOverride.method,
            value: taxOverride.value,
            columnName: taxOverride.columnName,
            enabled: true
          }
        : {
            method: settings?.tax_enabled ? settings?.tax_method : undefined,
            value: settings?.tax_enabled ? settings?.tax_value : undefined,
            columnName: settings?.tax_enabled ? settings?.tax_column_name : undefined,
            enabled: settings?.tax_enabled || false
          };

      console.log('Tax config to use:', taxConfig);

      // Convert amount and refund columns to numbers
      if (columns.amountColumn) {
        filteredRows = convertAmountColumnToNumbers(filteredRows, columns.amountColumn, 'Amount');
      }
      if (columns.refundColumn) {
        filteredRows = convertAmountColumnToNumbers(filteredRows, columns.refundColumn, 'Refund');
      }

      // Calculate totals
      let totalAmount = 0;
      let refundsAmount = 0;

      filteredRows.forEach((row: any) => {
        const amount = row[columns.amountColumn!] || 0;
        const refund = columns.refundColumn ? (row[columns.refundColumn] || 0) : 0;
        totalAmount += amount;
        refundsAmount += refund;
      });

      const netBeforeTax = totalAmount - refundsAmount;
      let taxAmount = 0;

      console.log('Total:', totalAmount, 'Refunds:', refundsAmount, 'Net Before Tax:', netBeforeTax);

      // Calculate tax based on method (only if enabled)
      if (taxConfig.enabled) {
        console.log('Tax is ENABLED - calculating...');
        if (taxConfig.method === 'fixed_percent') {
          taxAmount = (netBeforeTax * (taxConfig.value || 0)) / 100;
          console.log('Fixed % calculation: ', taxAmount);
        } else if (taxConfig.method === 'fixed_amount') {
          taxAmount = taxConfig.value || 0;
          console.log('Fixed amount: ', taxAmount);
        } else if (taxConfig.method === 'column_based') {
          filteredRows.forEach((row: any) => {
            taxAmount += parseFloat(row[taxConfig.columnName!] || 0);
          });
          console.log('Column based: ', taxAmount);
        }
      } else {
        console.log('Tax is DISABLED - setting to 0');
      }

      const netAmount = netBeforeTax + taxAmount;
      console.log('Final Tax Amount:', taxAmount, 'Final Amount:', netAmount);
      console.log('=====================================');

      setCalculation({
        totalAmount,
        refundsAmount,
        taxAmount,
        netAmount,
        rowsAfterFilter: filteredRows.length
      });
      setPhase('processed');
    } catch (err: any) {
      setUploadError(err.message || 'Calculation failed');
    }
  };
  
  // Save deposit
  const handleSave = async () => {
    if (!calculation || !selectedPaymentMethod || !startDate || !endDate) {
      setUploadError('Missing required information');
      return;
    }
    
    setProcessing(true);
    try {
      console.log('💾 SAVING DEPOSIT - AdminDepositForm:');
      console.log('   Tax Override:', taxOverride);
      console.log('   Settings Tax:', {
        enabled: settings?.tax_enabled,
        method: settings?.tax_method,
        value: settings?.tax_value,
        columnName: settings?.tax_column_name
      });
      console.log('   Calculated Tax Amount:', calculation.taxAmount);
      
      // Note: Do NOT persist settings automatically when saving a deposit.
      // Users should click 'Save Settings' to persist any changes to columns, filters, or tax overrides.
      // (Previously we saved settings here; removed to avoid unexpected persistence.)
      
      // Upload file to Supabase Storage and get public URL
      type ProofFile = { name: string; url: string; type: string; size: number };
      let proofFileUrlArr: ProofFile[] = [];
      if (file) {
        console.log('[UPLOAD] Starting file upload:', file.name, file.size, 'bytes');
        const uploadRes = await storage.uploadFile(currentUserId, file);
        if (uploadRes.error) {
          console.error('[UPLOAD] Failed to upload file:', uploadRes.error.message);
          setUploadError('Failed to upload file: ' + uploadRes.error.message);
          setProcessing(false);
          return;
        }
        const filePath = uploadRes.data?.path || null;
        console.log('[UPLOAD] File uploaded. Storage path:', filePath);
        if (filePath) {
          const { data: publicUrlData } = supabase.storage.from('accounting-files').getPublicUrl(filePath);
          console.log('[UPLOAD] Public URL data:', publicUrlData);
          if (publicUrlData?.publicUrl) {
            proofFileUrlArr = [{ name: file.name, url: publicUrlData.publicUrl, type: file.type, size: file.size }];
            console.log('[UPLOAD] Public URL:', publicUrlData.publicUrl);
          } else {
            console.warn('[UPLOAD] No public URL returned for file:', filePath);
          }
        } else {
          console.warn('[UPLOAD] No file path returned after upload.');
        }
      }

      console.log('[UPLOAD] Saving deposit with file URLs:', proofFileUrlArr);
      await saveDeposit({
        start_date: startDate,
        end_date: endDate,
        // primary payment method: use the base method if group exists, otherwise the selected method
        payment_method_id: methodGroup.length > 0 ? methodGroup[0].payment_method_id : selectedPaymentMethod,
        total_amount: calculation.totalAmount,
        tax_amount: calculation.taxAmount,
        net_amount: calculation.netAmount,
        notes: `Manually added by admin (${uploadedByEmail || 'system'})`,
        user_id: currentUserId,
        proof_file_url: JSON.stringify(proofFileUrlArr),
        method_group: methodGroup // jsonb column (array of ordered methods)
      });
      console.log('[UPLOAD] Deposit saved successfully.');
      
      setSuccessMessage('✓ Deposit saved successfully!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to save deposit');
    } finally {
      setProcessing(false);
    }
  };
  
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-96">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            <p>Loading form...</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl my-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Upload className="w-6 h-6" />
            Admin Add Deposit
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        {uploadError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {uploadError}
          </div>
        )}
        
        {successMessage && (
          <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded flex items-center gap-2">
            <Check className="w-5 h-5" />
            {successMessage}
          </div>
        )}
        
        {/* Phase 1: Initial Selection */}
        {phase === 'initial' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">
                Payment Method *
              </label>
              <select
                value={selectedPaymentMethod}
                onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a payment method</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.name_en}
                  </option>
                ))}
              </select>

              {/* Method Group UI - add multiple methods with ordering */}
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Add Method to Group</label>
                <div className="flex gap-2">
                  <select
                    value={methodToAdd}
                    onChange={(e) => setMethodToAdd(e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="">Select method to add</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name_en}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!methodToAdd) return;
                      const pm = paymentMethods.find(p => p.id === methodToAdd);
                      if (!pm) return;
                      setMethodGroup(prev => {
                        // Prevent duplicates
                        if (prev.find(m => m.payment_method_id === pm.id)) return prev;
                        return [...prev, { payment_method_id: pm.id, name_en: pm.name_en }];
                      });
                      setMethodToAdd('');
                    }}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
                  >
                    Add
                  </button>
                </div>

                {methodGroup.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs text-gray-500">Order (first = base method)</div>
                    <ul className="space-y-1">
                      {methodGroup.map((m, idx) => (
                        <li key={m.payment_method_id} className="flex items-center gap-2">
                          <div className="flex-1 text-sm">
                            <span className="font-medium">{idx === 0 ? 'Base: ' : `${idx + 1}. `}</span>
                            {m.name_en}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setMethodGroup(prev => {
                                const next = [...prev];
                                if (idx > 0) {
                                  const t = next[idx-1]; next[idx-1] = next[idx]; next[idx] = t;
                                }
                                return next;
                              })}
                              disabled={idx === 0}
                              className="px-2 py-0.5 text-xs bg-gray-100 rounded"
                            >Up</button>
                            <button
                              onClick={() => setMethodGroup(prev => {
                                const next = [...prev];
                                if (idx < next.length - 1) {
                                  const t = next[idx+1]; next[idx+1] = next[idx]; next[idx] = t;
                                }
                                return next;
                              })}
                              disabled={idx === methodGroup.length - 1}
                              className="px-2 py-0.5 text-xs bg-gray-100 rounded"
                            >Down</button>
                            <button
                              onClick={() => setMethodGroup(prev => prev.filter((_, i) => i !== idx))}
                              className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded"
                            >Remove</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">
                  End Date *
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">
                Upload File (Excel (.xlsx, .xls) or CSV) *
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {settings ? '✓ Settings loaded for this payment method' : 'No saved settings for this method'}
              </p>
            </div>

            {/* Tax Configuration Display */}
            {selectedPaymentMethod && (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-yellow-900">💰 Tax Configuration</h3>
                    {settings && settings.tax_enabled && !taxOverride.useOverride && (
                      <div className="mt-1 text-xs text-yellow-800">
                        <span className="font-medium">
                          {settings.tax_method === 'fixed_percent' && `📊 ${settings.tax_value}% Fixed Percentage`}
                          {settings.tax_method === 'fixed_amount' && `💵 ${settings.tax_value} EGP Fixed Amount`}
                          {settings.tax_method === 'column_based' && `📋 Column: ${settings.tax_column_name}`}
                        </span>
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={taxOverride.useOverride}
                      onChange={(e) => {
                        // Map UI method names to ensure consistency
                        const uiMethod = settings?.tax_method || 'none';
                        
                        setTaxOverride({
                          ...taxOverride,
                          useOverride: e.target.checked,
                          method: uiMethod as any,
                          value: settings?.tax_value,
                          columnName: settings?.tax_column_name
                        });
                      }}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-xs font-medium text-yellow-700">Override</span>
                  </label>
                </div>

                {(settings && settings.tax_enabled) || taxOverride.useOverride ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="block text-yellow-700 font-medium mb-1">Method</label>
                      <select
                        value={taxOverride.useOverride ? (taxOverride.method || 'none') : (() => {
                          // Map DB method names to UI names for display
                          const methodMap: any = {
                            'percentage': 'fixed_percent',
                            'fixed_amount': 'fixed_amount',
                            'column': 'column_based'
                          };
                          return methodMap[settings?.tax_method || ''] || settings?.tax_method || 'none';
                        })()}
                        onChange={(e) => {
                          if (!taxOverride.useOverride) {
                            setTaxOverride({
                              ...taxOverride,
                              useOverride: true,
                              method: e.target.value as any
                            });
                          } else {
                            setTaxOverride({
                              ...taxOverride,
                              method: e.target.value as any
                            });
                          }
                        }}
                        className="w-full px-2 py-1 border border-yellow-300 rounded text-xs"
                        disabled={!taxOverride.useOverride}
                      >
                        <option value="fixed_percent">Fixed Percentage (%)</option>
                        <option value="fixed_amount">Fixed Amount (EGP)</option>
                        <option value="column_based">Column Based</option>
                      </select>
                    </div>

                    {(taxOverride.useOverride ? taxOverride.method : (() => {
                      const methodMap: any = {
                        'percentage': 'fixed_percent',
                        'fixed_amount': 'fixed_amount',
                        'column': 'column_based'
                      };
                      return methodMap[settings?.tax_method || ''] || settings?.tax_method;
                    })()) === 'fixed_percent' && (
                      <div>
                        <label className="block text-yellow-700 font-medium mb-1">Percentage %</label>
                        <input
                          type="number"
                          step="0.01"
                          value={taxOverride.useOverride ? (taxOverride.value ?? settings?.tax_value ?? '') : (settings?.tax_value ?? '')}
                          onChange={(e) => {
                            if (!taxOverride.useOverride) {
                              setTaxOverride({
                                ...taxOverride,
                                useOverride: true,
                                value: parseFloat(e.target.value) || 0
                              });
                            } else {
                              setTaxOverride({
                                ...taxOverride,
                                value: parseFloat(e.target.value) || 0
                              });
                            }
                          }}
                          className="w-full px-2 py-1 border border-yellow-300 rounded text-xs"
                          disabled={!taxOverride.useOverride}
                        />
                      </div>
                    )}

                    {(taxOverride.useOverride ? taxOverride.method : (() => {
                      const methodMap: any = {
                        'percentage': 'fixed_percent',
                        'fixed_amount': 'fixed_amount',
                        'column': 'column_based'
                      };
                      return methodMap[settings?.tax_method || ''] || settings?.tax_method;
                    })()) === 'fixed_amount' && (
                      <div>
                        <label className="block text-yellow-700 font-medium mb-1">Amount (EGP)</label>
                        <input
                          type="number"
                          step="1"
                          value={taxOverride.useOverride ? (taxOverride.value ?? settings?.tax_value ?? '') : (settings?.tax_value ?? '')}
                          onChange={(e) => {
                            if (!taxOverride.useOverride) {
                              setTaxOverride({
                                ...taxOverride,
                                useOverride: true,
                                value: parseFloat(e.target.value) || 0
                              });
                            } else {
                              setTaxOverride({
                                ...taxOverride,
                                value: parseFloat(e.target.value) || 0
                              });
                            }
                          }}
                          className="w-full px-2 py-1 border border-yellow-300 rounded text-xs"
                          disabled={!taxOverride.useOverride}
                        />
                      </div>
                    )}

                    {(taxOverride.useOverride ? taxOverride.method : (() => {
                      const methodMap: any = {
                        'percentage': 'fixed_percent',
                        'fixed_amount': 'fixed_amount',
                        'column': 'column_based'
                      };
                      return methodMap[settings?.tax_method || ''] || settings?.tax_method;
                    })()) === 'column_based' && (
                      <div>
                        <label className="block text-yellow-700 font-medium mb-1">Tax Column</label>
                        <select
                          value={taxOverride.useOverride ? (taxOverride.columnName ?? settings?.tax_column_name ?? '') : (settings?.tax_column_name ?? '')}
                          onChange={(e) => {
                            if (!taxOverride.useOverride) {
                              setTaxOverride({
                                ...taxOverride,
                                useOverride: true,
                                columnName: e.target.value
                              });
                            } else {
                              setTaxOverride({
                                ...taxOverride,
                                columnName: e.target.value
                              });
                            }
                          }}
                          className="w-full px-2 py-1 border border-yellow-300 rounded text-xs"
                          disabled={!taxOverride.useOverride}
                        >
                          <option value="">Select column</option>
                          {fileData?.columns.map((col) => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-yellow-600">ℹ️ No tax configuration. Check Override to add custom tax.</p>
                )}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold mb-2">
                Uploaded By (optional)
              </label>
              <input
                type="email"
                value={uploadedByEmail}
                onChange={(e) => setUploadedByEmail(e.target.value)}
                placeholder="e.g. user@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
        
        {/* Phase 2: Column Configuration */}
        {phase === 'configured' && fileData && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">
                Amount Column *
              </label>
              <select
                value={columns.amountColumn || ''}
                onChange={(e) => handleColumnChange('amountColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select amount column</option>
                {fileData.columns.map((col) => (
                  <option key={col} value={col}>
                    {col} {isNumericColumn(fileData.rows, col) ? '(numeric)' : '(text)'}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">
                Refund Column (optional)
              </label>
              <select
                value={columns.refundColumn || ''}
                onChange={(e) => handleColumnChange('refundColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {fileData.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">
                Filter Column (optional)
              </label>
              <select
                value={columns.filterColumn || ''}
                onChange={(e) => handleColumnChange('filterColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {fileData.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
            
            {columns.filterColumn && distinctValues[columns.filterColumn] && (
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Filter Values ({distinctValues[columns.filterColumn].length} available)
                </label>
                
                {/* Select All checkbox */}
                <div className="mb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        (() => {
                          const filteredValues = distinctValues[columns.filterColumn].filter((value) => 
                            filterSearchTerm === '' || 
                            value.toLowerCase().includes(filterSearchTerm.toLowerCase())
                          );
                          const currentlySelected = columns.filterValues || [];
                          return filteredValues.length > 0 && filteredValues.every(value => currentlySelected.includes(value));
                        })()
                      }
                      ref={(el) => {
                        if (el && columns.filterColumn) {
                          const filteredValues = distinctValues[columns.filterColumn].filter((value) =>
                            filterSearchTerm === '' ||
                            value.toLowerCase().includes(filterSearchTerm.toLowerCase())
                          );
                          const currentlySelected = columns.filterValues || [];
                          const allFilteredSelected = filteredValues.every(value => currentlySelected.includes(value));
                          const someFilteredSelected = filteredValues.some(value => currentlySelected.includes(value));
                          el.indeterminate = !allFilteredSelected && someFilteredSelected;
                        }
                      }}
                      onChange={() => {
                        if (!columns.filterColumn) return;

                        const filteredValues = distinctValues[columns.filterColumn].filter((value) =>
                          filterSearchTerm === '' ||
                          value.toLowerCase().includes(filterSearchTerm.toLowerCase())
                        );
                        const currentlySelected = columns.filterValues || [];
                        
                        // Check if all filtered values are selected
                        const allFilteredSelected = filteredValues.every(value => currentlySelected.includes(value));
                        
                        if (allFilteredSelected) {
                          // Unselect all filtered values
                          const newSelected = currentlySelected.filter(value => !filteredValues.includes(value));
                          setColumns((prev) => ({
                            ...prev,
                            filterValues: newSelected
                          }));
                        } else {
                          // Select all filtered values
                          const newSelected = [...new Set([...currentlySelected, ...filteredValues])];
                          setColumns((prev) => ({
                            ...prev,
                            filterValues: newSelected
                          }));
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {(() => {
                        const filteredValues = distinctValues[columns.filterColumn].filter((value) => 
                          filterSearchTerm === '' || 
                          value.toLowerCase().includes(filterSearchTerm.toLowerCase())
                        );
                        const currentlySelected = columns.filterValues || [];
                        const allFilteredSelected = filteredValues.every(value => currentlySelected.includes(value));
                        
                        return allFilteredSelected && filteredValues.length > 0
                          ? `Unselect All (${filteredValues.length})`
                          : currentlySelected.some(value => filteredValues.includes(value))
                          ? `Select All (${filteredValues.length})`
                          : `Select All (${filteredValues.length})`;
                      })()}
                    </span>
                  </label>
                </div>
                
                {/* Search bar */}
                <div className="mb-2">
                  <input
                    type="text"
                    placeholder="Search filter values..."
                    value={filterSearchTerm}
                    onChange={(e) => setFilterSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 p-3 rounded">
                  {distinctValues[columns.filterColumn]
                    .filter((value) => 
                      filterSearchTerm === '' || 
                      value.toLowerCase().includes(filterSearchTerm.toLowerCase())
                    )
                    .map((value) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={columns.filterValues?.includes(value) || false}
                        onChange={() => handleFilterValueToggle(value)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-sm">{value}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Phase 3: Results */}
        {phase === 'processed' && calculation ? (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-700">Total Amount:</span>
                <span className="font-semibold">{(calculation.totalAmount || 0).toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Total Refunds:</span>
                <span className="font-semibold text-red-600">-{(calculation.refundsAmount || 0).toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <span className="text-gray-700">Net Before Tax:</span>
                <span className="font-semibold text-blue-600">{((calculation.totalAmount || 0) - (calculation.refundsAmount || 0)).toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Tax Amount:</span>
                <span className="font-semibold text-orange-600">+{(calculation.taxAmount || 0).toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="border-t pt-3 flex justify-between bg-green-50 p-3 rounded">
                <span className="font-semibold">Final Amount (Net + Tax):</span>
                <span className="font-bold text-lg text-green-700">{(calculation.netAmount || 0).toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Rows processed: {calculation.rowsAfterFilter || 0}
              </div>
            </div>
          </div>
        ) : null}
        
        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
          >
            Cancel
          </button>
          
          {phase === 'initial' && (
            <button
              onClick={() => {
                if (!selectedPaymentMethod || !startDate || !endDate || !file) {
                  setUploadError('Please fill all required fields and select a file');
                  return;
                }
                setPhase('configured');
              }}
              disabled={!selectedPaymentMethod || !startDate || !endDate || !file}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
            >
              Continue
            </button>
          )}
          
          {phase === 'configured' && (
            <button
              onClick={handleCalculate}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Calculate
            </button>
          )}
          
          {phase === 'processed' && (
            <div className="flex-1">
              <button
                onClick={handleSave}
                disabled={processing}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Save Deposit
                  </>
                )}
              </button>
              <div className="text-xs text-gray-500 mt-2">Note: Saving a deposit will NOT persist settings or tax overrides. Use <strong>Save Settings</strong> to store column/filter/tax changes.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

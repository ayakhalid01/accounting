'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { loadDepositSettings, saveDeposit } from '@/lib/supabase/deposits';
import {
  parseDepositFile,
  getDistinctValues,
  filterRowsByColumn,
  calculateDepositTotals,
  isNumericColumn
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
  
  // Calculations
  const [calculation, setCalculation] = useState<any>(null);
  const [settings, setSettings] = useState<DepositSettings | null>(null);
  const [processing, setProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
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
      
      const loadedSettings = await loadDepositSettings(selectedPaymentMethod);
      setSettings(loadedSettings);
      
      // Reset form
      setColumns({});
      setFile(null);
      setFileData(null);
      setUploadError('');
      setPhase('initial');
    };
    
    loadSettings();
  }, [selectedPaymentMethod]);
  
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
        if (settings.filter_column_name) {
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
  
  // Calculate deposit
  const handleCalculate = () => {
    if (!fileData || !columns.amountColumn) {
      setUploadError('Please select all required columns');
      return;
    }
    
    try {
      let filteredRows = fileData.rows;
      
      // Apply filter if specified
      if (columns.filterColumn && columns.filterValues && columns.filterValues.length > 0) {
        filteredRows = filterRowsByColumn(fileData.rows, columns.filterColumn, columns.filterValues);
      }
      
      // Calculate totals with tax settings if available
      const calc = calculateDepositTotals(
        filteredRows,
        columns.amountColumn,
        columns.refundColumn,
        settings?.tax_method,
        settings?.tax_value,
        settings?.tax_column_name
      );
      setCalculation(calc);
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
      await saveDeposit({
        startDate,
        endDate,
        paymentMethodId: selectedPaymentMethod,
        totalAmount: calculation.totalAmount,
        taxAmount: calculation.taxAmount,
        netAmount: calculation.netAmount,
        notes: `Manually added by admin (${uploadedByEmail || 'system'})`,
        createdBy: currentUserId
      });
      
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
                Upload File (Excel or CSV) *
              </label>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {settings ? '✓ Settings loaded for this payment method' : 'No saved settings for this method'}
              </p>
            </div>
            
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
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 p-3 rounded">
                  {distinctValues[columns.filterColumn].map((value) => (
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
        {phase === 'processed' && calculation && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-700">Total Amount:</span>
                <span className="font-semibold">{calculation.totalAmount.toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Total Refunds:</span>
                <span className="font-semibold text-red-600">-{calculation.totalRefunds.toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <span className="text-gray-700">Net Amount:</span>
                <span className="font-semibold text-blue-600">{calculation.netAmount.toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700">Tax:</span>
                <span className="font-semibold text-orange-600">+{calculation.taxAmount.toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="border-t pt-3 flex justify-between bg-green-50 p-3 rounded">
                <span className="font-semibold">Final Amount:</span>
                <span className="font-bold text-lg text-green-700">{calculation.finalAmount.toLocaleString('ar-EG')} EGP</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Rows processed: {calculation.rowsAfterFilter}
              </div>
            </div>
          </div>
        )}
        
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
            <button
              onClick={handleSave}
              disabled={processing}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium flex items-center justify-center gap-2"
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
          )}
        </div>
      </div>
    </div>
  );
}

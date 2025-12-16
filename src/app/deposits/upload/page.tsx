'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { loadDepositSettings, saveDepositSettings, saveDeposit } from '@/lib/supabase/deposits';
import {
  parseDepositFile,
  getDistinctValues,
  filterRowsByColumn,
  calculateDepositTotals,
  isNumericColumn
} from '@/lib/parsers/depositParser';
import { DepositFileData, DepositSettings, PaymentMethod } from '@/types';
import { Upload, Calendar, DollarSign, Settings, Check, AlertCircle } from 'lucide-react';

type DepositPhase = 'initial' | 'configured' | 'processed';

interface ColumnSelectState {
  filterColumn?: string;
  filterValues?: string[];
  amountColumn?: string;
  refundColumn?: string;
}

export default function DepositUploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Initial inputs
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  
  // File data
  const [fileData, setFileData] = useState<DepositFileData | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  
  // Phase management
  const [phase, setPhase] = useState<DepositPhase>('initial');
  
  // Column selection
  const [columns, setColumns] = useState<ColumnSelectState>({});
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});
  
  // Calculations
  const [calculations, setCalculations] = useState<any>(null);
  
  // Settings
  const [settings, setSettings] = useState<DepositSettings | null>(null);
  const [autoLoadedSettings, setAutoLoadedSettings] = useState(false);

  // Load payment methods
  useEffect(() => {
    const init = async () => {
      const { session } = await auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('name_en');

      setPaymentMethods(data || []);
      setLoading(false);
    };

    init();
  }, [router]);

  // Auto-load settings when payment method changes
  useEffect(() => {
    if (selectedPaymentMethod && phase === 'initial') {
      loadSettings();
    }
  }, [selectedPaymentMethod]);

  const loadSettings = async () => {
    if (!selectedPaymentMethod) return;
    
    const loaded = await loadDepositSettings(selectedPaymentMethod);
    setSettings(loaded);
    setAutoLoadedSettings(!!loaded);
  };

  const handleFileUpload = async () => {
    if (!file || !selectedPaymentMethod || !startDate || !endDate) {
      setUploadError('⚠️ Please fill all fields and select a file');
      return;
    }

    try {
      setUploadError('');
      console.log('📥 [DEPOSITS] Parsing file...');
      const parsed = await parseDepositFile(file);
      setFileData(parsed);
      
      // Auto-populate columns from settings if available
      if (settings) {
        setColumns({
          filterColumn: settings.filter_column_name,
          filterValues: settings.filter_include_values,
          amountColumn: settings.amount_column_name,
          refundColumn: settings.refund_column_name
        });
        setAutoLoadedSettings(true);
        console.log('⚡ [DEPOSITS] Auto-loaded columns from settings');
      }
      
      setPhase('configured');
    } catch (error) {
      setUploadError(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFilterColumnChange = (columnName: string) => {
    const values = columnName ? getDistinctValues(fileData?.rows || [], columnName) : [];
    setColumns(prev => ({
      ...prev,
      filterColumn: columnName,
      filterValues: columnName ? values : undefined
    }));
    setDistinctValues(prev => ({
      ...prev,
      [columnName]: values
    }));
  };

  const toggleFilterValue = (value: string) => {
    setColumns(prev => ({
      ...prev,
      filterValues: prev.filterValues?.includes(value)
        ? prev.filterValues.filter(v => v !== value)
        : [...(prev.filterValues || []), value]
    }));
  };

  const handleCalculate = () => {
    if (!fileData || !columns.amountColumn) {
      setUploadError('⚠️ Please select an amount column');
      return;
    }

    // Filter rows
    let filteredRows = filterRowsByColumn(
      fileData.rows,
      columns.filterColumn,
      columns.filterValues
    );

    // Calculate
    const calc = calculateDepositTotals(
      filteredRows,
      columns.amountColumn,
      columns.refundColumn,
      settings?.tax_method,
      settings?.tax_value,
      settings?.tax_column_name
    );

    setCalculations(calc);
    setPhase('processed');
  };

  const handleSaveDeposit = async () => {
    if (!calculations || !selectedPaymentMethod) return;

    try {
      await saveDeposit({
        payment_method_id: selectedPaymentMethod,
        start_date: startDate,
        end_date: endDate,
        file_name: file?.name,
        file_columns: fileData?.columns,
        total_rows_in_file: fileData?.rowCount,
        filter_column_name: columns.filterColumn,
        filter_include_values: columns.filterValues,
        amount_column_name: columns.amountColumn,
        refund_column_name: columns.refundColumn,
        rows_after_filter: calculations.rowsAfterFilter,
        total_amount: calculations.totalAmount,
        total_refunds: calculations.totalRefunds,
        net_amount: calculations.netAmount,
        tax_method: settings?.tax_method,
        tax_amount: calculations.taxAmount,
        final_amount: calculations.finalAmount,
        tax_enabled: settings?.tax_enabled,
        tax_value: settings?.tax_value,
        tax_column_name: settings?.tax_column_name
      });

      alert('✅ Deposit saved successfully!');
      resetForm();
    } catch (error) {
      setUploadError(`❌ Error saving deposit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedPaymentMethod || !columns.amountColumn) {
      setUploadError('⚠️ Please select at least an amount column');
      return;
    }

    try {
      await saveDepositSettings(selectedPaymentMethod, {
        filter_column_name: columns.filterColumn,
        filter_include_values: columns.filterValues,
        amount_column_name: columns.amountColumn,
        refund_column_name: columns.refundColumn,
        tax_enabled: settings?.tax_enabled || false,
        tax_method: settings?.tax_method || 'none',
        tax_value: settings?.tax_value,
        tax_column_name: settings?.tax_column_name
      });

      alert('✅ Settings saved successfully!');
      setAutoLoadedSettings(true);
    } catch (error) {
      setUploadError(`❌ Error saving settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetForm = () => {
    setFile(null);
    setFileData(null);
    setColumns({});
    setCalculations(null);
    setPhase('initial');
    setUploadError('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Submit New Deposits</h1>
          <p className="text-gray-600 mt-1">Upload and process your deposit files</p>
        </div>

        {/* Deposits Navigation Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-8">
            <button
              onClick={() => router.push('/deposits')}
              className="px-0 py-3 border-b-2 border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 font-medium"
            >
              Deposits
            </button>
          </nav>
        </div>        {/* Error Alert */}
        {uploadError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <span className="text-red-700">{uploadError}</span>
          </div>
        )}

        {/* Phase 1: Initial Upload */}
        {phase === 'initial' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Step 1: Upload Deposit File</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium mb-2">Payment Method *</label>
                <select
                  value={selectedPaymentMethod}
                  onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                >
                  <option value="">Select Payment Method...</option>
                  {paymentMethods.map(method => (
                    <option key={method.id} value={method.id}>
                      {method.name_en}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-sm font-medium mb-2">Start Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-sm font-medium mb-2">End Date *</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                />
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium mb-2">File (Excel/CSV) *</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                />
              </div>
            </div>

            {autoLoadedSettings && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                <Check className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-blue-700">⚡ Settings auto-loaded from configuration</span>
              </div>
            )}

            <button
              onClick={handleFileUpload}
              disabled={!file || !selectedPaymentMethod || !startDate || !endDate}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Done Upload
            </button>
          </div>
        )}

        {/* Phase 2: Configure Columns */}
        {phase === 'configured' && fileData && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Step 2: Configure Columns</h2>

            <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>File:</strong> {file?.name} | <strong>Rows:</strong> {fileData.rowCount} | <strong>Columns:</strong> {fileData.columns.length}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Filter Column */}
              <div>
                <label className="block text-sm font-medium mb-2">Filter Column (Optional)</label>
                <select
                  value={columns.filterColumn || ''}
                  onChange={(e) => handleFilterColumnChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                >
                  <option value="">-- None --</option>
                  {fileData.columns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>

                {columns.filterColumn && distinctValues[columns.filterColumn] && (
                  <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Values:</p>
                    {distinctValues[columns.filterColumn].map(value => (
                      <label key={value} className="flex items-center gap-2 text-sm mb-1">
                        <input
                          type="checkbox"
                          checked={columns.filterValues?.includes(value) || false}
                          onChange={() => toggleFilterValue(value)}
                          className="rounded"
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Amount Column */}
              <div>
                <label className="block text-sm font-medium mb-2">Amount Column (Required) *</label>
                <select
                  value={columns.amountColumn || ''}
                  onChange={(e) => setColumns(prev => ({ ...prev, amountColumn: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                >
                  <option value="">-- Select Column --</option>
                  {fileData.columns
                    .filter(col => isNumericColumn(fileData.rows, col))
                    .map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                </select>
              </div>

              {/* Refund Column */}
              <div>
                <label className="block text-sm font-medium mb-2">Refund Column (Optional)</label>
                <select
                  value={columns.refundColumn || ''}
                  onChange={(e) => setColumns(prev => ({ ...prev, refundColumn: e.target.value || undefined }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                >
                  <option value="">-- None --</option>
                  {fileData.columns
                    .filter(col => isNumericColumn(fileData.rows, col))
                    .map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCalculate}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                Calculate & Process
              </button>
              <button
                onClick={resetForm}
                className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-medium"
              >
                Reset
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Save Settings
              </button>
            </div>
          </div>
        )}

        {/* Phase 3: Results */}
        {phase === 'processed' && calculations && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold mb-6">Step 3: Review Results</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {/* Total Amount */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-700 mb-1">Total Amount (EGP)</p>
                <p className="text-2xl font-bold text-blue-900">
                  {calculations.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-blue-600 mt-1">{calculations.rowsAfterFilter} rows processed</p>
              </div>

              {/* Total Refunds */}
              {calculations.totalRefunds > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700 mb-1">Total Refunds (EGP)</p>
                  <p className="text-2xl font-bold text-red-900">
                    ({calculations.totalRefunds.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </p>
                </div>
              )}

              {/* Net Amount */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-700 mb-1">Net Amount (EGP)</p>
                <p className="text-2xl font-bold text-green-900">
                  {calculations.netAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              {/* Tax Amount */}
              {calculations.taxAmount > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-700 mb-1">Tax Amount (EGP)</p>
                  <p className="text-2xl font-bold text-yellow-900">
                    {calculations.taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}

              {/* Final Amount */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-sm text-purple-700 mb-1">Final Amount (EGP)</p>
                <p className="text-2xl font-bold text-purple-900">
                  {calculations.finalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveDeposit}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Save Deposit
              </button>
              <button
                onClick={() => setPhase('configured')}
                className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-medium"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

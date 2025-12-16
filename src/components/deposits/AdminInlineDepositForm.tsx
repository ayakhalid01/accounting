'use client';

import React, { useState, useEffect } from 'react';
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
import { Upload, Calendar, DollarSign, X, ChevronDown } from 'lucide-react';

interface AdminInlineDepositFormProps {
  onClose: () => void;
  onSuccess: () => void;
  currentUserId: string;
  paymentMethods: PaymentMethod[];
}

interface ColumnSelectState {
  filterColumn?: string;
  filterValues?: string[];
  amountColumn?: string;
  refundColumn?: string;
}

export default function AdminInlineDepositForm({
  onClose,
  onSuccess,
  currentUserId,
  paymentMethods
}: AdminInlineDepositFormProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState<string>('');

  const [fileData, setFileData] = useState<DepositFileData | null>(null);
  const [uploadError, setUploadError] = useState<string>('');

  const [columns, setColumns] = useState<ColumnSelectState>({});
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});

  const [calculation, setCalculation] = useState<any>(null);
  const [settings, setSettings] = useState<DepositSettings | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      setCalculation(null);
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
      setUploadError('Please select amount column');
      return;
    }

    try {
      let filteredRows = fileData.rows;

      if (columns.filterColumn && columns.filterValues && columns.filterValues.length > 0) {
        filteredRows = filterRowsByColumn(fileData.rows, columns.filterColumn, columns.filterValues);
      }

      const calc = calculateDepositTotals(
        filteredRows,
        columns.amountColumn,
        columns.refundColumn,
        settings?.tax_method,
        settings?.tax_value,
        settings?.tax_column_name
      );
      setCalculation(calc);
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

    setSubmitting(true);
    try {
      await saveDeposit({
        startDate,
        endDate,
        paymentMethodId: selectedPaymentMethod,
        totalAmount: calculation.totalAmount,
        taxAmount: calculation.taxAmount,
        netAmount: calculation.netAmount,
        notes: notes || 'Added by admin',
        createdBy: currentUserId
      });

      alert('✅ Deposit saved successfully!');
      onSuccess();
      onClose();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to save deposit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Upload className="h-5 w-5 text-green-600" />
          Admin Add Deposit
        </h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <X className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      {uploadError && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {uploadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Payment Method *
          </label>
          <select
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
          >
            <option value="">Select a payment method</option>
            {paymentMethods.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {pm.name_en}
              </option>
            ))}
          </select>
        </div>
        <div></div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Start Date *
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            End Date *
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Upload File (Excel or CSV) *
        </label>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={handleFileChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
        />
        {settings && <p className="text-xs text-green-600 mt-1">✓ Settings loaded</p>}
      </div>

      {fileData && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-blue-50 rounded">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Column *
              </label>
              <select
                value={columns.amountColumn || ''}
                onChange={(e) => handleColumnChange('amountColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="">Select column</option>
                {fileData.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Refund Column (optional)
              </label>
              <select
                value={columns.refundColumn || ''}
                onChange={(e) => handleColumnChange('refundColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filter Column (optional)
              </label>
              <select
                value={columns.filterColumn || ''}
                onChange={(e) => handleColumnChange('filterColumn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="">None</option>
                {fileData.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {columns.filterColumn && distinctValues[columns.filterColumn] && (
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter Values ({distinctValues[columns.filterColumn].length})
              </label>
              <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
                {distinctValues[columns.filterColumn].map((value) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={columns.filterValues?.includes(value) || false}
                      onChange={() => handleFilterValueToggle(value)}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-xs">{value}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
          placeholder="Optional notes..."
        />
      </div>

      {calculation && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
          <div className="grid grid-cols-5 gap-2 text-sm">
            <div>
              <p className="text-gray-600">Total</p>
              <p className="font-bold text-green-700">{calculation.totalAmount.toLocaleString('ar-EG')} EGP</p>
            </div>
            <div>
              <p className="text-gray-600">Refunds</p>
              <p className="font-bold text-red-600">-{calculation.totalRefunds.toLocaleString('ar-EG')}</p>
            </div>
            <div>
              <p className="text-gray-600">Net</p>
              <p className="font-bold text-blue-600">{calculation.netAmount.toLocaleString('ar-EG')}</p>
            </div>
            <div>
              <p className="text-gray-600">Tax</p>
              <p className="font-bold text-orange-600">+{calculation.taxAmount.toLocaleString('ar-EG')}</p>
            </div>
            <div>
              <p className="text-gray-600">Final</p>
              <p className="font-bold text-lg text-green-700">{calculation.finalAmount.toLocaleString('ar-EG')}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
        >
          Cancel
        </button>
        {!calculation ? (
          <button
            onClick={handleCalculate}
            disabled={!fileData || !columns.amountColumn || !selectedPaymentMethod || !startDate || !endDate}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
          >
            Calculate
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={submitting}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium"
          >
            {submitting ? 'Saving...' : 'Save Deposit'}
          </button>
        )}
      </div>
    </div>
  );
}

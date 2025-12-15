'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { loadDepositSettings, saveDepositSettings, deleteDepositSettings } from '@/lib/supabase/deposits';
import { DepositSettings, PaymentMethod, TaxCalculationMethod } from '@/types';
import { Settings, Save, Trash2, Plus, Edit2, X, Check, AlertCircle } from 'lucide-react';

interface SettingsForm extends Partial<DepositSettings> {
  paymentMethodId: string;
}

export default function DepositSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [allSettings, setAllSettings] = useState<Map<string, DepositSettings>>(new Map());
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [editingSettings, setEditingSettings] = useState<SettingsForm | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Form state
  const [form, setForm] = useState<SettingsForm>({
    paymentMethodId: '',
    filter_column_name: '',
    filter_include_values: [],
    amount_column_name: '',
    refund_column_name: '',
    tax_enabled: false,
    tax_method: 'none',
    tax_value: undefined,
    tax_column_name: ''
  });

  const [newFilterValue, setNewFilterValue] = useState('');

  // Initialize
  useEffect(() => {
    const init = async () => {
      const { session } = await auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // Check if admin
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profile?.role !== 'admin') {
        router.push('/dashboard');
        return;
      }

      setIsAdmin(true);

      // Load payment methods
      const { data: methods } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('name_en');

      setPaymentMethods(methods || []);

      // Load all settings
      if (methods) {
        const settingsMap = new Map<string, DepositSettings>();
        for (const method of methods) {
          const settings = await loadDepositSettings(method.id);
          if (settings) {
            settingsMap.set(method.id, settings);
          }
        }
        setAllSettings(settingsMap);
      }

      setLoading(false);
    };

    init();
  }, [router]);

  // Load settings for selected method
  const handleSelectMethod = (methodId: string) => {
    setSelectedMethod(methodId);
    setError('');
    setSuccess('');

    const existingSettings = allSettings.get(methodId);

    if (existingSettings) {
      setForm({
        paymentMethodId: methodId,
        filter_column_name: existingSettings.filter_column_name,
        filter_include_values: existingSettings.filter_include_values || [],
        amount_column_name: existingSettings.amount_column_name,
        refund_column_name: existingSettings.refund_column_name,
        tax_enabled: existingSettings.tax_enabled,
        tax_method: existingSettings.tax_method,
        tax_value: existingSettings.tax_value,
        tax_column_name: existingSettings.tax_column_name
      });
    } else {
      setForm({
        paymentMethodId: methodId,
        filter_column_name: '',
        filter_include_values: [],
        amount_column_name: '',
        refund_column_name: '',
        tax_enabled: false,
        tax_method: 'none',
        tax_value: undefined,
        tax_column_name: ''
      });
    }
  };

  const handleAddFilterValue = () => {
    if (newFilterValue.trim()) {
      setForm(prev => ({
        ...prev,
        filter_include_values: [...(prev.filter_include_values || []), newFilterValue.trim()]
      }));
      setNewFilterValue('');
    }
  };

  const handleRemoveFilterValue = (value: string) => {
    setForm(prev => ({
      ...prev,
      filter_include_values: (prev.filter_include_values || []).filter(v => v !== value)
    }));
  };

  const handleSaveSettings = async () => {
    try {
      setError('');
      setSuccess('');

      if (!form.paymentMethodId) {
        setError('⚠️ Please select a payment method');
        return;
      }

      if (!form.amount_column_name) {
        setError('⚠️ Please specify an amount column');
        return;
      }

      if (form.tax_enabled) {
        if (form.tax_method === 'none') {
          setError('⚠️ Please select a tax calculation method');
          return;
        }

        if ((form.tax_method === 'fixed_percent' || form.tax_method === 'fixed_amount') && !form.tax_value) {
          setError('⚠️ Please enter a tax value');
          return;
        }

        if (form.tax_method === 'column_based' && !form.tax_column_name) {
          setError('⚠️ Please select a tax column');
          return;
        }
      }

      console.log('💾 [SETTINGS] Saving deposit settings...');

      await saveDepositSettings(form.paymentMethodId, {
        filter_column_name: form.filter_column_name || undefined,
        filter_include_values: form.filter_include_values?.length ? form.filter_include_values : undefined,
        amount_column_name: form.amount_column_name,
        refund_column_name: form.refund_column_name || undefined,
        tax_enabled: form.tax_enabled,
        tax_method: form.tax_method,
        tax_value: form.tax_value,
        tax_column_name: form.tax_column_name || undefined
      });

      // Update local state
      const updated = {
        ...form,
        id: allSettings.get(form.paymentMethodId)?.id || '',
        created_at: allSettings.get(form.paymentMethodId)?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as DepositSettings;

      setAllSettings(prev => new Map(prev).set(form.paymentMethodId, updated));
      setSuccess('✅ Settings saved successfully!');
      console.log('✅ [SETTINGS] Saved for method:', form.paymentMethodId);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`❌ Error saving settings: ${message}`);
      console.error('❌ [SETTINGS] Error:', err);
    }
  };

  const handleDeleteSettings = async () => {
    if (!form.paymentMethodId) return;

    if (!window.confirm('Are you sure you want to delete these settings?')) return;

    try {
      setError('');
      setSuccess('');

      await deleteDepositSettings(form.paymentMethodId);

      setAllSettings(prev => {
        const updated = new Map(prev);
        updated.delete(form.paymentMethodId);
        return updated;
      });

      setSelectedMethod('');
      setForm({
        paymentMethodId: '',
        filter_column_name: '',
        filter_include_values: [],
        amount_column_name: '',
        refund_column_name: '',
        tax_enabled: false,
        tax_method: 'none'
      });

      setSuccess('✅ Settings deleted successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`❌ Error deleting settings: ${message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-lg font-semibold">Access Denied</p>
          <p className="text-gray-600">Only admins can access this page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold">Deposit Settings</h1>
          </div>
          <p className="text-gray-600">Configure deposit processing for each payment method</p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-300 rounded-lg flex items-start gap-3">
            <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-green-700">{success}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Method List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-lg font-semibold mb-4">Payment Methods</h2>
              <div className="space-y-2">
                {paymentMethods.map(method => (
                  <button
                    key={method.id}
                    onClick={() => handleSelectMethod(method.id)}
                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                      selectedMethod === method.id
                        ? 'bg-blue-100 border-2 border-blue-500 text-blue-900 font-semibold'
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{method.name_en}</span>
                      {allSettings.has(method.id) && (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Settings Form */}
          <div className="lg:col-span-3">
            {selectedMethod ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-6">
                  {paymentMethods.find(m => m.id === selectedMethod)?.name_en} Settings
                </h2>

                {/* Column Configuration */}
                <div className="mb-8 pb-8 border-b border-gray-200">
                  <h3 className="text-base font-semibold mb-4 text-gray-900">Column Mapping</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Filter Column */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Filter Column (Optional)</label>
                      <input
                        type="text"
                        value={form.filter_column_name || ''}
                        onChange={(e) => setForm(prev => ({ ...prev, filter_column_name: e.target.value || undefined }))}
                        placeholder="e.g. Account Type"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                      />
                      <p className="text-xs text-gray-500 mt-1">Column name to filter by</p>
                    </div>

                    {/* Amount Column */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Amount Column *</label>
                      <input
                        type="text"
                        value={form.amount_column_name || ''}
                        onChange={(e) => setForm(prev => ({ ...prev, amount_column_name: e.target.value }))}
                        placeholder="e.g. Total"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                      />
                      <p className="text-xs text-gray-500 mt-1">Column to sum for total amount</p>
                    </div>

                    {/* Refund Column */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Refund Column (Optional)</label>
                      <input
                        type="text"
                        value={form.refund_column_name || ''}
                        onChange={(e) => setForm(prev => ({ ...prev, refund_column_name: e.target.value || undefined }))}
                        placeholder="e.g. Refund"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                      />
                      <p className="text-xs text-gray-500 mt-1">Column to subtract from total</p>
                    </div>
                  </div>

                  {/* Filter Values */}
                  {form.filter_column_name && (
                    <div className="mt-6">
                      <label className="block text-sm font-medium mb-2">Default Filter Values</label>
                      <p className="text-xs text-gray-500 mb-3">Add default filter values to auto-select when uploading</p>

                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          value={newFilterValue}
                          onChange={(e) => setNewFilterValue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleAddFilterValue()}
                          placeholder="Enter value and press Enter"
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 bg-white"
                        />
                        <button
                          onClick={handleAddFilterValue}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      {form.filter_include_values && form.filter_include_values.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {form.filter_include_values.map(value => (
                            <div
                              key={value}
                              className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full"
                            >
                              <span>{value}</span>
                              <button
                                onClick={() => handleRemoveFilterValue(value)}
                                className="hover:text-blue-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tax Configuration */}
                <div className="mb-8">
                  <h3 className="text-base font-semibold mb-4 text-gray-900">Tax Configuration</h3>

                  <div className="mb-6">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={form.tax_enabled || false}
                        onChange={(e) =>
                          setForm(prev => ({
                            ...prev,
                            tax_enabled: e.target.checked,
                            tax_method: e.target.checked ? 'fixed_percent' : 'none'
                          }))
                        }
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm font-medium">Enable Tax Calculation</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1 ml-7">
                      If disabled, tax will be locked/hidden in deposit submissions
                    </p>
                  </div>

                  {form.tax_enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Tax Method */}
                      <div>
                        <label className="block text-sm font-medium mb-2">Tax Calculation Method *</label>
                        <select
                          value={form.tax_method || 'none'}
                          onChange={(e) =>
                            setForm(prev => ({
                              ...prev,
                              tax_method: e.target.value as TaxCalculationMethod,
                              tax_value: undefined,
                              tax_column_name: undefined
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                        >
                          <option value="none">-- Select Method --</option>
                          <option value="fixed_percent">Fixed Percentage (%)</option>
                          <option value="fixed_amount">Fixed Amount (EGP)</option>
                          <option value="column_based">From Column in File</option>
                        </select>
                      </div>

                      {/* Tax Value (Percent or Amount) */}
                      {(form.tax_method === 'fixed_percent' || form.tax_method === 'fixed_amount') && (
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            {form.tax_method === 'fixed_percent' ? 'Percentage (%)' : 'Amount (EGP)'}
                          </label>
                          <input
                            type="number"
                            value={form.tax_value || ''}
                            onChange={(e) =>
                              setForm(prev => ({
                                ...prev,
                                tax_value: e.target.value ? parseFloat(e.target.value) : undefined
                              }))
                            }
                            placeholder={form.tax_method === 'fixed_percent' ? '2.5' : '50000'}
                            step={form.tax_method === 'fixed_percent' ? '0.01' : '1'}
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                          />
                        </div>
                      )}

                      {/* Tax Column */}
                      {form.tax_method === 'column_based' && (
                        <div>
                          <label className="block text-sm font-medium mb-2">Tax Column Name</label>
                          <input
                            type="text"
                            value={form.tax_column_name || ''}
                            onChange={(e) =>
                              setForm(prev => ({
                                ...prev,
                                tax_column_name: e.target.value || undefined
                              }))
                            }
                            placeholder="e.g. Tax Amount"
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white"
                          />
                          <p className="text-xs text-gray-500 mt-1">Column in file that contains tax values to sum</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveSettings}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save Settings
                  </button>

                  {allSettings.has(selectedMethod) && (
                    <button
                      onClick={handleDeleteSettings}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">Select a payment method to configure</p>
              </div>
            )}
          </div>
        </div>

        {/* Summary Table */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">All Configured Methods</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Payment Method</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Filter Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Amount Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Refund Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tax Method</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paymentMethods.map(method => {
                  const settings = allSettings.get(method.id);
                  return (
                    <tr key={method.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleSelectMethod(method.id)}>
                      <td className="px-6 py-3 text-sm font-medium">{method.name_en}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.filter_column_name || '-'}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.amount_column_name || '-'}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.refund_column_name || '-'}
                      </td>
                      <td className="px-6 py-3 text-sm">
                        {settings?.tax_enabled ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                            {settings.tax_method === 'fixed_percent' && `${settings.tax_value}%`}
                            {settings.tax_method === 'fixed_amount' && `${settings.tax_value} EGP`}
                            {settings.tax_method === 'column_based' && 'From File'}
                          </span>
                        ) : (
                          <span className="text-gray-400">Disabled</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm">
                        {settings ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            ✓ Configured
                          </span>
                        ) : (
                          <span className="text-gray-400">Not Configured</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

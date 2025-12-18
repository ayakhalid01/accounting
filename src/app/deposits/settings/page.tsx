'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { loadDepositSettings, saveDepositSettings, deleteDepositSettings } from '@/lib/supabase/deposits';
import { DepositSettings, PaymentMethod, TaxCalculationMethod } from '@/types';
import { Settings, Save, Trash2, Plus, Edit2, X, Check, AlertCircle, Download, Upload } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load all settings helper (can be called after import to refresh)
  const loadAllSettings = async (methodsParam?: PaymentMethod[]) => {
    const methodsToUse = methodsParam || paymentMethods;
    if (!methodsToUse || methodsToUse.length === 0) return;

    setUiLoadPhase('Loading deposit settings...');
    const settingsArr = await Promise.all(
      methodsToUse.map(method => loadDepositSettings(method.id))
    );
    const settingsMap = new Map<string, DepositSettings>();
    settingsArr.forEach((settings, idx) => {
      if (settings) {
        settingsMap.set(methodsToUse[idx].id, settings);
      }
    });
    setAllSettings(settingsMap);
    setUiLoadPhase('Complete!');
  };

  // Initialize
  useEffect(() => {
    const init = async () => {
      console.log('[SETTINGS] Phase 1: Getting session...');
      setLoading(true);
      setUiLoadPhase('Getting session...');
      const { session } = await auth.getSession();
      if (!session) {
        setUiLoadPhase('Redirecting to login...');
        router.push('/login');
        return;
      }

      console.log('[SETTINGS] Phase 2: Checking admin...');
      setUiLoadPhase('Checking admin permissions...');
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profile?.role !== 'admin') {
        setUiLoadPhase('Redirecting to dashboard...');
        router.push('/dashboard');
        return;
      }

      setIsAdmin(true);

      console.log('[SETTINGS] Phase 3: Loading payment methods...');
      setUiLoadPhase('Loading payment methods...');
      const { data: methods } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('name_en');

      setPaymentMethods(methods || []);

      // Load settings for these methods
      await loadAllSettings(methods || []);

      setLoading(false);
      console.log('[SETTINGS] Phase 5: Load complete.');
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
      // Map DB tax_method to UI value, allow legacy DB values
      let tax_method: TaxCalculationMethod = 'none';
      switch (existingSettings.tax_method as string) {
        case 'percentage':
          tax_method = 'fixed_percent';
          break;
        case 'fixed_amount':
          tax_method = 'fixed_amount';
          break;
        case 'column':
          tax_method = 'column_based';
          break;
        case 'no_tax':
          tax_method = 'none';
          break;
        default:
          tax_method = 'none';
      }
      setForm({
        paymentMethodId: methodId,
        filter_column_name: existingSettings.filter_column_name || '',
        filter_include_values: existingSettings.filter_include_values || [],
        amount_column_name: existingSettings.amount_column_name || '',
        refund_column_name: existingSettings.refund_column_name || '',
        tax_enabled: existingSettings.tax_enabled,
        tax_method,
        tax_value: existingSettings.tax_value,
        tax_column_name: existingSettings.tax_column_name || ''
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


      // Map UI values to DB values and types
      let tax_method: TaxCalculationMethod = 'none'; // Will be saved to DB
      let tax_value: number | undefined = undefined;
      let tax_column_name: string | undefined = undefined;
      
      if (form.tax_enabled) {
        if (form.tax_method === 'fixed_percent') tax_method = 'fixed_percent';
        else if (form.tax_method === 'fixed_amount') tax_method = 'fixed_amount';
        else if (form.tax_method === 'column_based') tax_method = 'column_based';
        else tax_method = 'none';

        if (tax_method === 'fixed_percent' || tax_method === 'fixed_amount') {
          if (form.tax_value === undefined || form.tax_value === null) {
            setError('⚠️ Please enter a tax value');
            return;
          }
          tax_value = form.tax_value;
        }
        if (tax_method === 'column_based') {
          if (!form.tax_column_name) {
            setError('⚠️ Please select a tax column');
            return;
          }
          tax_column_name = form.tax_column_name;
        }
      } else {
        // Tax disabled: set to none with all fields null
        tax_method = 'none';
        tax_value = undefined;
        tax_column_name = undefined;
      }

      // Enforce DB constraint: clear unused fields
      if (tax_method === 'none') {
        tax_value = undefined;
        tax_column_name = undefined;
      }
      if (tax_method === 'fixed_percent' || tax_method === 'fixed_amount') {
        tax_column_name = undefined;
      }
      if (tax_method === 'column_based') {
        tax_value = undefined;
      }

      console.log('💾 [SETTINGS] Saving deposit settings...');

      await saveDepositSettings(form.paymentMethodId, {
        // Pass raw values so empty string clears the column explicitly (server maps '' -> NULL)
        filter_column_name: form.filter_column_name,
        filter_include_values: form.filter_include_values?.length ? form.filter_include_values : undefined,
        amount_column_name: form.amount_column_name,
        refund_column_name: form.refund_column_name,
        tax_enabled: form.tax_enabled,
        tax_method,
        tax_value,
        tax_column_name
      });

      // Update local state
      const updated = {
        ...form,
        tax_method,
        tax_value,
        tax_column_name,
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

  // Download / Upload handlers
  const handleDownloadSettings = (format: 'json' | 'csv' = 'csv', methodId?: string) => {
    try {
      const exportArrAll = Array.from(allSettings.values());
      const exportArr = methodId ? (allSettings.has(methodId) ? [allSettings.get(methodId)].filter(Boolean) as any[] : []) : exportArrAll;

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(exportArr, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `deposit_settings_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        console.log('[EXPORT] Settings exported (JSON)', exportArr.length);
        return;
      }

      // CSV export
      const headers = [
        'payment_method_id',
        'payment_method_name',
        'filter_column',
        'amount_column',
        'refund_column',
        'tax_enabled',
        'tax_method',
        'tax_value',
        'tax_column',
        'filter_values'
      ];

      // Build a lookup for payment method names
      const pmById = new Map(paymentMethods.map(pm => [pm.id, pm] as [string, PaymentMethod]));

      const rows = exportArr.map((s: any) => {
        return headers.map(h => {
          let val: any = null;
          switch (h) {
            case 'payment_method_name':
              val = s.payment_method_name || (s.payment_method_id ? (pmById.get(s.payment_method_id)?.name_en) : '') || '';
              break;
            case 'filter_values':
              val = Array.isArray(s.filter_include_values) ? s.filter_include_values.join('|') : (Array.isArray(s.filter_values) ? s.filter_values.join('|') : '');
              break;
            case 'filter_column':
              val = s.filter_column || s.filter_column_name || '';
              break;
            case 'amount_column':
              val = s.amount_column || s.amount_column_name || '';
              break;
            case 'refund_column':
              val = s.refund_column || s.refund_column_name || '';
              break;
            case 'tax_column':
              val = s.tax_column || s.tax_column_name || '';
              break;
            default:
              val = s[h] ?? '';
          }
          // Escape double quotes
          if (typeof val === 'string') val = val.replace(/"/g, '""');
          return `"${val}"`;
        }).join(',');
      });

      const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deposit_settings_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      console.log('[EXPORT] Settings exported (CSV)', exportArr.length);
    } catch (err) {
      console.error('[EXPORT] Error exporting settings', err);
      alert('Error exporting settings');
    }
  };

  // Handle upload of CSV/JSON for All Configured Methods
  const handleUploadAllSettingsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let arr: any[] = [];

      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) arr = parsed;
        else if (typeof parsed === 'object' && parsed !== null) arr = Object.values(parsed);
        else throw new Error('Invalid JSON format');
      } else if (file.name.endsWith('.csv')) {
        // Very small CSV parser - expects header row
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) throw new Error('CSV must include header and at least one row');
        const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          // Split respecting quoted commas
          const fields: string[] = [];
          let current = '';
          let inQuotes = false;
          for (let chIdx = 0; chIdx < row.length; chIdx++) {
            const ch = row[chIdx];
            if (ch === '"') {
              // Check for escaped quote
              if (inQuotes && row[chIdx + 1] === '"') {
                current += '"';
                chIdx++; // skip next
              } else {
                inQuotes = !inQuotes;
              }
            } else if (ch === ',' && !inQuotes) {
              fields.push(current);
              current = '';
            } else {
              current += ch;
            }
          }
          fields.push(current);

          const obj: any = {};
          headers.forEach((h, idx) => {
            let val = (fields[idx] || '').trim();
            // Unescape quotes
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/""/g, '"');
            // For filter_values split by | into array
            if (h === 'filter_values') {
              obj.filter_include_values = val ? val.split('|').map((s: string) => s.trim()).filter(Boolean) : undefined;
            } else {
              obj[h] = val === '' ? undefined : val;
            }
          });
          arr.push(obj);
        }
      } else {
        throw new Error('Unsupported file type, please upload CSV or JSON');
      }

      if (!arr.length) {
        alert('No settings objects found in the file');
        return;
      }

      if (!confirm(`Apply ${arr.length} settings and overwrite existing ones?`)) return;

      setUiLoadPhase('Importing settings...');
      setLoading(true);

      const savePromises = arr.map(async (item: any) => {
        // Resolve payment method id: prefer explicit ids, otherwise try lookup by name (case-insensitive)
        let pmId = item.payment_method_id || item.paymentMethodId || item.payment_method || item.paymentMethodId;
        if (!pmId) {
          const name = (item.payment_method_name || item.payment_method_name || item.payment_method || '').trim();
          if (name) {
            const found = paymentMethods.find(pm => (pm.name_en || '').toLowerCase() === name.toLowerCase());
            if (found) pmId = found.id;
          }
        }
        if (!pmId) return { id: null, ok: false, err: 'missing payment_method_id' };
        try {
          // Normalize fields for saveDepositSettings
          const payload: any = {
            amount_column_name: item.amount_column || item.amount_column_name || undefined,
            refund_column_name: item.refund_column || item.refund_column_name || undefined,
            filter_column_name: item.filter_column || item.filter_column_name || undefined,
            filter_include_values: item.filter_include_values || item.filter_values || undefined,
            // Do NOT default tax_enabled to false; keep undefined when missing so we don't overwrite
            tax_enabled: item.tax_enabled,
            tax_method: item.tax_method || undefined,
            tax_value: item.tax_value ? Number(item.tax_value) : undefined,
            tax_column_name: item.tax_column || item.tax_column_name || undefined
          };

          // Parse booleans and numbers robustly (accept TRUE/True/true, Yes/1 etc.)
          const parseBool = (v: any) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v === 'boolean') return v;
            const s = String(v).trim().toLowerCase();
            if (s === '') return undefined;
            return ['true', 'yes', '1', 'y'].includes(s);
          };
          const parseNumber = (v: any) => {
            if (v === undefined || v === null || v === '') return undefined;
            const n = Number(String(v).trim());
            return Number.isNaN(n) ? undefined : n;
          };

          // Normalize payload types
          const normalizedPayload = {
            ...payload,
            tax_enabled: parseBool(payload.tax_enabled),
            tax_value: parseNumber(payload.tax_value)
          };

          const saved = await saveDepositSettings(pmId, normalizedPayload);
          return { id: saved?.id || null, ok: true };
        } catch (err: any) {
          return { id: pmId, ok: false, err: err.message || String(err) };
        }
      });

      const results = await Promise.all(savePromises);
      console.log('[IMPORT] Results:', results);

      const successCount = results.filter(r => r.ok).length;
      alert(`Import complete. ${successCount} of ${results.length} saved successfully.`);

      // Refresh settings
      await loadAllSettings();
    } catch (err: any) {
      console.error('[IMPORT] Error importing settings', err);
      alert('Error importing settings: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
      setUiLoadPhase('');
      // Clear file input value to allow re-upload
      (e.target as HTMLInputElement).value = '';
    }
  };

  const handleTriggerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      let arr: any[] = [];
      if (Array.isArray(parsed)) arr = parsed;
      else if (typeof parsed === 'object' && parsed !== null) arr = Object.values(parsed);
      else throw new Error('Invalid JSON format');

      if (!arr.length) {
        alert('No settings objects found in the file');
        return;
      }

      if (!confirm(`Apply ${arr.length} settings and overwrite existing ones?`)) return;

      setUiLoadPhase('Importing settings...');
      setLoading(true);

      // Save all in parallel but limit mapping/normalization
      const savePromises = arr.map(async (item: any) => {
        const pmId = item.payment_method_id || item.paymentMethodId || item.payment_method || item.paymentMethodId;
        if (!pmId) return { id: null, ok: false, err: 'missing payment_method_id' };

        // normalize tax_method legacy values
        let tax_method = item.tax_method as string | undefined;
        if (tax_method === 'percentage') tax_method = 'fixed_percent';
        if (tax_method === 'column') tax_method = 'column_based';
        if (tax_method === 'no_tax') tax_method = 'none';
        if (!tax_method) tax_method = 'none';

        const settingsPayload: any = {
          filter_column_name: item.filter_column_name ?? item.filter_column ?? undefined,
          filter_include_values: item.filter_include_values?.length ? item.filter_include_values : undefined,
          amount_column_name: item.amount_column_name ?? item.amount_column ?? undefined,
          refund_column_name: item.refund_column_name ?? item.refund_column ?? undefined,
          tax_enabled: !!item.tax_enabled,
          tax_method,
          tax_value: item.tax_value ?? undefined,
          tax_column_name: item.tax_column_name ?? item.tax_column ?? undefined
        };

        try {
          await saveDepositSettings(pmId, settingsPayload);
          return { id: pmId, ok: true };
        } catch (err) {
          return { id: pmId, ok: false, err };
        }
      });

      const results = await Promise.all(savePromises);

      // reload updated settings for affected methods
      const updatedMap = new Map(allSettings);
      for (const r of results) {
        if (r.ok && r.id) {
          try {
            const loaded = await loadDepositSettings(r.id);
            if (loaded) updatedMap.set(r.id, loaded);
          } catch (e) {
            console.warn('[IMPORT] Failed reload for', r.id, e);
          }
        }
      }

      setAllSettings(updatedMap);
      setLoading(false);
      setUiLoadPhase('');
      alert('Import finished');
    } catch (err) {
      console.error('[IMPORT] Failed', err);
      alert('Failed to import settings: ' + ((err as Error).message || err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
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


  const [uiLoadPhase, setUiLoadPhase] = useState<string>('');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <div className="text-blue-700 font-semibold text-lg">{uiLoadPhase || 'Loading...'}</div>
        </div>
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

        {/* Deposits Navigation Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-8">
            <button
              onClick={() => router.push('/deposits')}
              className="px-0 py-3 border-b-2 border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 font-medium"
            >
              Deposits
            </button>
            <button
              onClick={() => router.push('/deposits/settings')}
              className="px-0 py-3 border-b-2 border-blue-600 text-blue-600 font-medium"
            >
              Settings
            </button>
          </nav>
        </div>        {/* Alerts */}
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
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
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
                        onChange={(e) => setForm(prev => ({ ...prev, filter_column_name: e.target.value }))}
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
                        onChange={(e) => setForm(prev => ({ ...prev, refund_column_name: e.target.value }))}
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

                  <button
                    onClick={() => handleDownloadSettings('csv', form.paymentMethodId || selectedMethod || undefined)}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>

                  <button
                    onClick={handleTriggerUpload}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload
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
                <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleUploadFile} style={{ display: 'none' }} />
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">Select a payment method to configure</p>
              </div>
            )}
          </div>
        </div>

        {/* Download/Upload Buttons and Summary Table */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between px-6 py-4 border-b border-gray-200 gap-4">
            <h2 className="text-lg font-semibold">All Configured Methods</h2>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
                onClick={() => handleDownloadSettings('csv')}
              >
                Download
              </button>
              <label className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-2 cursor-pointer">
                Upload
                <input
                  type="file"
                  accept=".csv,.json"
                  style={{ display: 'none' }}
                  onChange={handleUploadAllSettingsFile}
                />
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Payment Method</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Filter Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Amount Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Refund Column</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tax Enabled</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tax Type</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tax Value</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tax Column Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paymentMethods.map(method => {
                  const settings = allSettings.get(method.id);
                  // Debug: log settings for each row
                  console.log('[TABLE_ROW]', method.name_en, settings);
                  const tm = settings ? (settings.tax_method as string) : undefined;
                  return (
                    <tr key={method.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleSelectMethod(method.id)}>
                      <td className="px-6 py-3 text-sm font-medium">{method.name_en}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{settings?.filter_column_name || '-'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{settings?.amount_column_name || '-'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{settings?.refund_column_name || '-'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{settings ? (settings.tax_enabled ? 'Yes' : 'No') : '-'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.tax_enabled ? (
                          (tm === 'fixed_percent' || tm === 'percentage') ? 'Fixed Percentage (%)'
                          : (tm === 'fixed_amount') ? 'Fixed Amount (EGP)'
                          : (tm === 'column_based' || tm === 'column') ? 'From Column'
                          : (tm === 'none' || tm === 'no_tax') ? 'No Tax'
                          : '-'
                        ) : '-'}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.tax_enabled ? (
                          (tm === 'fixed_percent' || tm === 'percentage' || tm === 'fixed_amount')
                            ? (settings.tax_value !== undefined ? settings.tax_value : '-')
                            : (tm === 'column_based' || tm === 'column') ? '-' : '-'
                        ) : '-'}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {settings?.tax_enabled && (tm === 'column_based' || tm === 'column')
                          ? (settings.tax_column_name || '-')
                          : '-'}
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

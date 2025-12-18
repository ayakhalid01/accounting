import { supabase } from './client';
import { DepositSettings } from '@/types';

/**
 * Load deposit settings for a specific payment method
 */
export async function loadDepositSettings(paymentMethodId: string): Promise<DepositSettings | null> {
  try {
    const { data, error } = await supabase
      .from('payment_method_deposit_settings')
      .select('*')
      .eq('payment_method_id', paymentMethodId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ [DEPOSIT_SETTINGS] Load error:', error);
      throw error;
    }

    if (!data) return null;

    // Map database schema back to app schema (_name suffix)
    const appSettings: any = { ...data };
    
    // Map database column names to app naming convention (add _name suffix)
    if (data.tax_column !== undefined && !data.tax_column_name) {
      appSettings.tax_column_name = data.tax_column;
    }
    if (data.amount_column !== undefined && !data.amount_column_name) {
      appSettings.amount_column_name = data.amount_column;
    }
    if (data.refund_column !== undefined && !data.refund_column_name) {
      appSettings.refund_column_name = data.refund_column;
    }
    if (data.filter_column !== undefined && !data.filter_column_name) {
      appSettings.filter_column_name = data.filter_column;
    }
    if (data.filter_values !== undefined && !data.filter_include_values) {
      appSettings.filter_include_values = data.filter_values;
    }

    return appSettings;
  } catch (error) {
    console.error('❌ [DEPOSIT_SETTINGS] Exception:', error);
    return null;
  }
}

/**
 * Save or update deposit settings for a payment method
 */
let _depositSettingsColumnsChecked = false;
const _missingDepositSettingsCols = new Set<string>();

async function ensureDepositSettingsColumns() {
  if (_depositSettingsColumnsChecked) return;
  try {
    // Try selecting canonical columns to determine which exist in this DB
    const { error } = await supabase
      .from('payment_method_deposit_settings')
      .select('refund_column,amount_column,filter_column,tax_column', { head: true });
    if (error) {
      if (error.code === 'PGRST204' && typeof error.message === 'string') {
        const colRegex = /Could not find the '([^']+)' column/g;
        let m: RegExpExecArray | null;
        while ((m = colRegex.exec(error.message)) !== null) {
          _missingDepositSettingsCols.add(m[1]);
        }
      } else {
        // Non-schema error; log and continue
        console.warn('Could not detect deposit settings columns:', error);
      }
    }
  } catch (err) {
    console.warn('Exception while detecting deposit settings columns:', err);
  } finally {
    _depositSettingsColumnsChecked = true;
  }
}

export async function saveDepositSettings(
  paymentMethodId: string,
  settings: Partial<DepositSettings>
): Promise<DepositSettings | null> {
  try {
    // Ensure we know which columns exist in the DB to avoid PGRST204 errors
    await ensureDepositSettingsColumns();
    // Validate tax_method if provided
    const VALID_TAX_METHODS = ['no_tax', 'percentage', 'fixed_amount', 'column', 'fixed_percent', 'column_based', 'none'];
    if (settings.tax_method && !VALID_TAX_METHODS.includes(settings.tax_method)) {
      console.warn('⚠️ Invalid tax_method:', settings.tax_method, '- Valid methods:', VALID_TAX_METHODS);
    }
    
    // Map app schema names to database schema names (remove _name suffix)
    const dbSettings: any = {};
    
    // Ensure caller provided a paymentMethodId
    if (!paymentMethodId) {
      throw new Error('paymentMethodId is required');
    }

    // Copy payment_method_id (use the function arg to avoid relying on caller-provided payload)
    dbSettings.payment_method_id = paymentMethodId;
    
    // Map column names: _name → without _name
    // Also cleanup old naming to avoid confusion
    if (settings.tax_column_name !== undefined) {
      // Prefer canonical tax_column if available
      if (!_missingDepositSettingsCols.has('tax_column')) {
        dbSettings.tax_column = settings.tax_column_name;
        dbSettings.tax_column_name = null; // Clear old naming
      } else {
        dbSettings.tax_column_name = settings.tax_column_name === '' ? null : settings.tax_column_name;
      }
    }

    if (settings.amount_column_name !== undefined) {
      if (!_missingDepositSettingsCols.has('amount_column')) {
        dbSettings.amount_column = settings.amount_column_name === '' ? null : settings.amount_column_name;
        dbSettings.amount_column_name = null; // Clear old naming
      } else {
        dbSettings.amount_column_name = settings.amount_column_name === '' ? null : settings.amount_column_name;
      }
    }

    if (settings.refund_column_name !== undefined) {
      if (!_missingDepositSettingsCols.has('refund_column')) {
        dbSettings.refund_column = settings.refund_column_name === '' ? null : settings.refund_column_name;
        dbSettings.refund_column_name = null; // Clear old naming
      } else {
        // Write directly to legacy column when canonical is missing
        dbSettings.refund_column_name = settings.refund_column_name === '' ? null : settings.refund_column_name;
      }
    }

    if (settings.filter_column_name !== undefined) {
      // Treat empty string as explicit clear (map to NULL)
      if (!_missingDepositSettingsCols.has('filter_column')) {
        dbSettings.filter_column = settings.filter_column_name === '' ? null : settings.filter_column_name;
        dbSettings.filter_column_name = null; // Clear old naming
      } else {
        dbSettings.filter_column_name = settings.filter_column_name === '' ? null : settings.filter_column_name;
      }
    }
    
    // Map filter values
    if (settings.filter_include_values !== undefined) {
      dbSettings.filter_values = settings.filter_include_values;
      dbSettings.filter_include_values = null; // Clear old naming
    }
    
    // Copy tax settings as-is
    if (settings.tax_enabled !== undefined) {
      dbSettings.tax_enabled = settings.tax_enabled;
    }
    if (settings.tax_method !== undefined) {
      dbSettings.tax_method = settings.tax_method;
    }
    if (settings.tax_value !== undefined) {
      dbSettings.tax_value = settings.tax_value;
    }
    
    // Map UI tax method names to DB tax method names
    if (dbSettings.tax_method === 'fixed_percent') {
      dbSettings.tax_method = 'percentage';
    } else if (dbSettings.tax_method === 'column_based') {
      dbSettings.tax_method = 'column';
    } else if (dbSettings.tax_method === 'none') {
      dbSettings.tax_method = 'no_tax';
    }
    
    // Default tax_method to 'no_tax' if not provided (satisfies tax_method_check constraint)
    if (!dbSettings.tax_method) {
      dbSettings.tax_method = 'no_tax';
    }

    // Handle tax constraint validation:
    // For no_tax/percentage/fixed_amount: tax_column must be null
    // For column tax: tax_column must be set
    if (dbSettings.tax_method === 'no_tax' || dbSettings.tax_method === 'percentage' || dbSettings.tax_method === 'fixed_amount') {
      dbSettings.tax_column = null; // Explicitly set to null to satisfy constraint
    }
    
    // For non-column tax methods, ensure tax_value is set
    if (dbSettings.tax_method === 'no_tax') {
      dbSettings.tax_value = null;
    }
    
    console.log('📝 Saving settings (mapped to DB schema):', dbSettings);

    const { data: existing } = await supabase
      .from('payment_method_deposit_settings')
      .select('id')
      .eq('payment_method_id', paymentMethodId)
      .maybeSingle();

    let result;

    if (existing) {
      // Update existing
      result = await supabase
        .from('payment_method_deposit_settings')
        .update({
          ...dbSettings,
          updated_at: new Date().toISOString()
        })
        .eq('payment_method_id', paymentMethodId)
        .select()
        .single();
    } else {
      // Insert new
      result = await supabase
        .from('payment_method_deposit_settings')
        .insert({
          payment_method_id: paymentMethodId,
          ...dbSettings
        })
        .select()
        .single();
    }

    if (result.error) {
      console.error('❌ [DEPOSIT_SETTINGS] Save error:', result.error);
      // Handle missing column errors from PostgREST (older DB schemas may not have recently added columns)
      if (result.error.code === 'PGRST204' && typeof result.error.message === 'string') {
        const missingCols: string[] = [];
        const colRegex = /Could not find the '([^']+)' column/g;
        let m: RegExpExecArray | null;
        while ((m = colRegex.exec(result.error.message)) !== null) {
          missingCols.push(m[1]);
        }

        if (missingCols.length > 0) {
          console.log('ℹ️ Detected missing columns in DB schema, retrying without them:', missingCols);
          // Attempt a compatibility retry: if the canonical column (e.g., 'refund_column') is missing,
          // try writing to the legacy '<col>_name' column if the caller provided that value.
          missingCols.forEach(col => {
            // Remove canonical if present
            delete dbSettings[col];

            // If the user provided a legacy '<col>_name' in the original settings payload, preserve that
            const legacyKey = `${col}_name`;
            if ((settings as any)[legacyKey] !== undefined) {
              // Prefer the explicit legacy value ('' means clear)
              dbSettings[legacyKey] = (settings as any)[legacyKey] === '' ? null : (settings as any)[legacyKey];
            } else if ((settings as any)[col] !== undefined) {
              // If they provided canonical in payload, map it back into legacy field
              dbSettings[legacyKey] = (settings as any)[col] === '' ? null : (settings as any)[col];
            }

            // Do NOT delete the legacy key here — we want to preserve it for older schemas
          });

          if (existing) {
            const retry = await supabase
              .from('payment_method_deposit_settings')
              .update({
                ...dbSettings,
                updated_at: new Date().toISOString()
              })
              .eq('payment_method_id', paymentMethodId)
              .select()
              .single();

            if (retry.error) {
              console.error('❌ [DEPOSIT_SETTINGS] Retry save error:', retry.error);
              throw retry.error;
            }

            result = retry;
          } else {
            const retry = await supabase
              .from('payment_method_deposit_settings')
              .insert({
                payment_method_id: paymentMethodId,
                ...dbSettings
              })
              .select()
              .single();

            if (retry.error) {
              console.error('❌ [DEPOSIT_SETTINGS] Retry save error:', retry.error);
              throw retry.error;
            }

            result = retry;
          }
        } else {
          throw result.error;
        }
      } else {
        throw result.error;
      }
    }

    console.log('✅ [DEPOSIT_SETTINGS] Saved for method:', paymentMethodId);
    console.log('   Data:', result.data);
    return result.data;
  } catch (error) {
    console.error('❌ [DEPOSIT_SETTINGS] Exception:', error);
    throw error;
  }
}

/**
 * Delete deposit settings
 */
export async function deleteDepositSettings(paymentMethodId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('payment_method_deposit_settings')
      .delete()
      .eq('payment_method_id', paymentMethodId);

    if (error) {
      console.error('❌ [DEPOSIT_SETTINGS] Delete error:', error);
      throw error;
    }

    console.log('✅ [DEPOSIT_SETTINGS] Deleted for method:', paymentMethodId);
  } catch (error) {
    console.error('❌ [DEPOSIT_SETTINGS] Delete exception:', error);
    throw error;
  }
}

/**
 * Save a submitted deposit
 */
export async function saveDeposit(depositData: any): Promise<any> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    console.log('📝 [DEPOSITS] Inserting data:', {
      total_amount: depositData.total_amount,
      tax_amount: depositData.tax_amount,
      net_amount: depositData.net_amount,
      payment_method_id: depositData.payment_method_id
    });

    const { data, error } = await supabase
      .from('deposits')
      .insert({
        ...depositData,
        user_id: user?.id
      })
      .select()
      .single();

    if (error) {
      console.error('❌ [DEPOSITS] Save error:', error);
      throw error;
    }

    console.log('✅ [DEPOSITS] Saved deposit:', data);
    console.log('   - ID:', data.id);
    console.log('   - Tax Amount:', data.tax_amount);
    console.log('   - Net Amount:', data.net_amount);
    return data;
  } catch (error) {
    console.error('❌ [DEPOSITS] Exception:', error);
    throw error;
  }
}

/**
 * Load all deposits with filters
 */
export async function loadDeposits(filters?: {
  paymentMethodId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<any[]> {
  try {
    let query = supabase
      .from('deposits')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.paymentMethodId) {
      query = query.eq('payment_method_id', filters.paymentMethodId);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters?.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ [DEPOSITS] Load error:', error);
      throw error;
    }

    console.log('✅ [DEPOSITS] Loaded:', data?.length || 0, 'deposits');
    return data || [];
  } catch (error) {
    console.error('❌ [DEPOSITS] Exception:', error);
    return [];
  }
}

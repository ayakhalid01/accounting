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

    return data || null;
  } catch (error) {
    console.error('❌ [DEPOSIT_SETTINGS] Exception:', error);
    return null;
  }
}

/**
 * Save or update deposit settings for a payment method
 */
export async function saveDepositSettings(
  paymentMethodId: string,
  settings: Partial<DepositSettings>
): Promise<DepositSettings | null> {
  try {
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
          ...settings,
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
          ...settings
        })
        .select()
        .single();
    }

    if (result.error) {
      console.error('❌ [DEPOSIT_SETTINGS] Save error:', result.error);
      throw result.error;
    }

    console.log('✅ [DEPOSIT_SETTINGS] Saved for method:', paymentMethodId);
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

    const { data, error } = await supabase
      .from('deposits')
      .insert({
        ...depositData,
        created_by: user?.id
      })
      .select()
      .single();

    if (error) {
      console.error('❌ [DEPOSITS] Save error:', error);
      throw error;
    }

    console.log('✅ [DEPOSITS] Saved deposit:', data.id);
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

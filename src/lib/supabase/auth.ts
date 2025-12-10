import { supabase } from './client';
import type { UserProfile, UserRole } from '@/types';

export const auth = {
  /**
   * Get current user session
   */
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    return { session, error };
  },

  /**
   * Get current user with profile
   */
  async getCurrentUser(): Promise<{ user: any; profile: UserProfile | null }> {
    console.log('👤 [AUTH] Getting current user...');
    const { session } = await this.getSession();
    
    if (!session?.user) {
      console.log('⚠️ [AUTH] No session found');
      return { user: null, profile: null };
    }

    console.log('✅ [AUTH] Session found for user:', session.user.email);
    console.log('🔍 [AUTH] Fetching user profile...');
    
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (profile) {
      console.log('✅ [AUTH] Profile loaded - Role:', profile.role);
    } else {
      console.log('⚠️ [AUTH] No profile found in database');
    }

    return { user: session.user, profile: profile as UserProfile | null };
  },

  /**
   * Sign in with email and password
   */
  async signIn(email: string, password: string) {
    console.log('🔐 [AUTH] signIn called');
    console.log('📧 [AUTH] Email:', email);
    console.log('🌐 [AUTH] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) + '...');
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.error('❌ [AUTH] signInWithPassword failed');
      console.error('❌ [AUTH] Error message:', error.message);
      console.error('❌ [AUTH] Error status:', error.status);
      console.error('❌ [AUTH] Full error:', error);
    } else {
      console.log('✅ [AUTH] signInWithPassword successful');
      console.log('👤 [AUTH] User ID:', data.user?.id);
      console.log('📧 [AUTH] User email:', data.user?.email);
      console.log('🎫 [AUTH] Session:', !!data.session);
    }
    
    return { data, error };
  },

  /**
   * Sign out
   */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  /**
   * Sign up new user
   */
  async signUp(email: string, password: string, fullName: string, role: UserRole = 'accountant') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role,
        },
      },
    });

    if (error || !data.user) return { data: null, error };

    // Create user profile
    const profileData: any = {
      id: data.user.id,
      email,
      full_name: fullName,
      role,
    };
    
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert(profileData);

    if (profileError) return { data: null, error: profileError };

    return { data, error: null };
  },

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: any) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    return { data, error };
  },

  /**
   * Check if current user is admin
   */
  async isAdmin(): Promise<boolean> {
    const { profile } = await this.getCurrentUser();
    return profile?.role === 'admin' && profile.is_active;
  },

  /**
   * Check if current user is accountant or admin
   */
  async isAccountantOrAdmin(): Promise<boolean> {
    const { profile } = await this.getCurrentUser();
    return (profile?.role === 'accountant' || profile?.role === 'admin') && profile.is_active;
  },

  /**
   * Change user password
   */
  async changePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error };
  },

  /**
   * Reset password via email
   */
  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    return { error };
  },
};

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'supabase.auth.token',
      flowType: 'pkce',
    },
  }
);

console.log('🔧 [SUPABASE] Client initialized');
console.log('🌐 [SUPABASE] URL:', supabaseUrl?.substring(0, 30) + '...');

// Storage helper functions
export const storage = {
  /**
   * Upload file to Supabase Storage
   */
  async uploadFile(
    userId: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<{ data: { path: string } | null; error: Error | null }> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      // Simulate progress
      if (onProgress) {
        const interval = setInterval(() => {
          const progress = Math.min(Math.random() * 30 + 50, 95);
          onProgress(progress);
        }, 200);

        const { data, error } = await supabase.storage
          .from('accounting-files')
          .upload(filePath, file);

        clearInterval(interval);
        onProgress(100);

        if (error) throw error;

        return { data: { path: filePath }, error: null };
      }

      const { data, error } = await supabase.storage
        .from('accounting-files')
        .upload(filePath, file);

      if (error) throw error;

      return { data: { path: filePath }, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  },

  /**
   * Download file from Supabase Storage
   */
  async downloadFile(path: string): Promise<Blob | null> {
    try {
      const { data, error } = await supabase.storage
        .from('accounting-files')
        .download(path);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error downloading file:', error);
      return null;
    }
  },

  /**
   * Get public URL for file
   */
  getPublicUrl(path: string): string {
    const { data } = supabase.storage
      .from('accounting-files')
      .getPublicUrl(path);

    return data.publicUrl;
  },

  /**
   * Delete file from storage
   */
  async deleteFile(path: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase.storage
        .from('accounting-files')
        .remove([path]);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  /**
   * List files in user's folder
   */
  async listFiles(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase.storage
        .from('accounting-files')
        .list(userId);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error listing files:', error);
      return [];
    }
  }
};

// Supabase Database Types (auto-generated structure)
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: 'admin' | 'accountant';
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: 'admin' | 'accountant';
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: 'admin' | 'accountant';
          is_active?: boolean;
          updated_at?: string;
        };
      };
      payment_methods: {
        Row: {
          id: string;
          name_ar: string;
          name_en: string;
          code: string;
          type: 'paymob' | 'manual' | 'bank';
          is_active: boolean;
          odoo_id: string | null;
          tax_rate: number;
          payment_period_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name_ar: string;
          name_en: string;
          code: string;
          type: 'paymob' | 'manual' | 'bank';
          is_active?: boolean;
          odoo_id?: string | null;
          tax_rate?: number;
          payment_period_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name_ar?: string;
          name_en?: string;
          code?: string;
          type?: 'paymob' | 'manual' | 'bank';
          is_active?: boolean;
          odoo_id?: string | null;
          tax_rate?: number;
          payment_period_days?: number;
          updated_at?: string;
        };
      };
      invoices: {
        Row: {
          id: string;
          invoice_number: string;
          odoo_invoice_id: string | null;
          partner_name: string | null;
          payment_method_id: string | null;
          invoice_date: string;
          due_date: string | null;
          amount_untaxed: number;
          amount_tax: number;
          amount_total: number;
          currency: string;
          state: 'draft' | 'posted' | 'paid' | 'cancelled';
          invoice_type: 'invoice' | 'credit_note';
          notes: string | null;
          imported_by: string | null;
          imported_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          invoice_number: string;
          odoo_invoice_id?: string | null;
          partner_name?: string | null;
          payment_method_id?: string | null;
          invoice_date: string;
          due_date?: string | null;
          amount_untaxed: number;
          amount_tax?: number;
          amount_total: number;
          currency?: string;
          state: 'draft' | 'posted' | 'paid' | 'cancelled';
          invoice_type: 'invoice' | 'credit_note';
          notes?: string | null;
          imported_by?: string | null;
          imported_at?: string;
          created_at?: string;
        };
        Update: {
          invoice_number?: string;
          odoo_invoice_id?: string | null;
          partner_name?: string | null;
          payment_method_id?: string | null;
          invoice_date?: string;
          due_date?: string | null;
          amount_untaxed?: number;
          amount_tax?: number;
          amount_total?: number;
          currency?: string;
          state?: 'draft' | 'posted' | 'paid' | 'cancelled';
          invoice_type?: 'invoice' | 'credit_note';
          notes?: string | null;
        };
      };
      credit_notes: {
        Row: {
          id: string;
          credit_note_number: string;
          odoo_credit_note_id: string | null;
          original_invoice_id: string | null;
          partner_name: string | null;
          payment_method_id: string | null;
          credit_date: string;
          amount_untaxed: number;
          amount_tax: number;
          amount_total: number;
          currency: string;
          state: 'draft' | 'posted' | 'cancelled';
          reason: string | null;
          notes: string | null;
          imported_by: string | null;
          imported_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          credit_note_number: string;
          odoo_credit_note_id?: string | null;
          original_invoice_id?: string | null;
          partner_name?: string | null;
          payment_method_id?: string | null;
          credit_date: string;
          amount_untaxed: number;
          amount_tax?: number;
          amount_total: number;
          currency?: string;
          state: 'draft' | 'posted' | 'cancelled';
          reason?: string | null;
          notes?: string | null;
          imported_by?: string | null;
          imported_at?: string;
          created_at?: string;
        };
        Update: {
          credit_note_number?: string;
          odoo_credit_note_id?: string | null;
          original_invoice_id?: string | null;
          partner_name?: string | null;
          payment_method_id?: string | null;
          credit_date?: string;
          amount_untaxed?: number;
          amount_tax?: number;
          amount_total?: number;
          currency?: string;
          state?: 'draft' | 'posted' | 'cancelled';
          reason?: string | null;
          notes?: string | null;
        };
      };
      accounting_uploads: {
        Row: {
          id: string;
          payment_method_id: string;
          total_amount: number;
          date_from: string;
          date_to: string;
          include_end_date: boolean;
          status: 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected';
          created_by: string;
          created_at: string;
          submitted_at: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
          admin_notes: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          payment_method_id: string;
          total_amount: number;
          date_from: string;
          date_to: string;
          include_end_date?: boolean;
          status?: 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected';
          created_by: string;
          created_at?: string;
          submitted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          admin_notes?: string | null;
          updated_at?: string;
        };
        Update: {
          payment_method_id?: string;
          total_amount?: number;
          date_from?: string;
          date_to?: string;
          include_end_date?: boolean;
          status?: 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected';
          submitted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          admin_notes?: string | null;
          updated_at?: string;
        };
      };
      upload_files: {
        Row: {
          id: string;
          upload_id: string;
          file_name: string;
          file_path: string;
          file_type: 'excel' | 'csv' | 'pdf' | 'image';
          file_size_bytes: number;
          mime_type: string;
          rows_count: number | null;
          columns_count: number | null;
          preview_data: Json | null;
          uploaded_at: string;
          uploaded_by: string;
        };
        Insert: {
          id?: string;
          upload_id: string;
          file_name: string;
          file_path: string;
          file_type: 'excel' | 'csv' | 'pdf' | 'image';
          file_size_bytes: number;
          mime_type: string;
          rows_count?: number | null;
          columns_count?: number | null;
          preview_data?: Json | null;
          uploaded_at?: string;
          uploaded_by: string;
        };
        Update: {
          file_name?: string;
          rows_count?: number | null;
          columns_count?: number | null;
          preview_data?: Json | null;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          action_type: string;
          entity_type: string;
          entity_id: string | null;
          performed_by: string | null;
          ip_address: string | null;
          user_agent: string | null;
          old_values: Json | null;
          new_values: Json | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          action_type: string;
          entity_type: string;
          entity_id?: string | null;
          performed_by?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          old_values?: Json | null;
          new_values?: Json | null;
          description?: string | null;
          created_at?: string;
        };
        Update: {};
      };
      notification_emails: {
        Row: {
          id: string;
          email: string;
          notification_type: 'upload_submitted' | 'upload_approved' | 'upload_rejected' | 'all';
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          notification_type: 'upload_submitted' | 'upload_approved' | 'upload_rejected' | 'all';
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string;
          notification_type?: 'upload_submitted' | 'upload_approved' | 'upload_rejected' | 'all';
          is_active?: boolean;
        };
      };
    };
    Views: {
      net_sales_view: {
        Row: {
          invoice_id: string;
          invoice_number: string;
          payment_method_id: string;
          payment_method_name: string;
          invoice_date: string;
          invoice_amount: number;
          credit_amount: number;
          net_amount: number;
        };
      };
      dashboard_summary: {
        Row: {
          payment_method_id: string;
          payment_method: string;
          month: string;
          total_invoices: number;
          total_credits: number;
          net_sales: number;
          approved_deductions: number;
          net_after_deduction: number;
        };
      };
    };
    Functions: {
      get_user_role: {
        Returns: string;
      };
      is_admin: {
        Returns: boolean;
      };
      is_accountant_or_admin: {
        Returns: boolean;
      };
    };
  };
};

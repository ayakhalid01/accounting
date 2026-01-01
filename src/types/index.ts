// Database Types
export type UserRole = 'admin' | 'accountant';

export type UploadStatus = 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected';

export type FileType = 'excel' | 'csv' | 'pdf' | 'image';

export type InvoiceState = 'draft' | 'posted' | 'paid' | 'cancelled';

export type InvoiceType = 'invoice' | 'credit_note';

export type PaymentMethodType = 'paymob' | 'manual' | 'bank';

export type AuditActionType =
  | 'upload_created'
  | 'upload_edited'
  | 'upload_deleted'
  | 'upload_submitted'
  | 'upload_approved'
  | 'upload_rejected'
  | 'file_uploaded'
  | 'file_deleted'
  | 'file_downloaded'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'login'
  | 'logout'
  | 'permission_changed';

export type AuditEntityType =
  | 'accounting_upload'
  | 'upload_file'
  | 'user'
  | 'invoice'
  | 'credit_note'
  | 'payment_method';

// Database Tables
export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethod {
  id: string;
  name_ar: string;
  name_en: string;
  code: string;
  type: PaymentMethodType;
  is_active: boolean;
  odoo_id?: string;
  tax_rate: number;
  payment_period_days: number;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  odoo_invoice_id?: string;
  partner_name?: string;
  payment_method_id?: string;
  invoice_date: string;
  sale_order_date: string; // The actual sale order date - primary date for calculations
  due_date?: string;
  amount_total: number; // Total amount from "Total in Currency Signed" column
  currency: string;
  state: InvoiceState;
  invoice_type: InvoiceType;
  notes?: string;
  imported_by?: string;
  imported_at: string;
  created_at: string;
}

export interface CreditNote {
  id: string;
  credit_note_number: string;
  odoo_credit_note_id?: string;
  original_invoice_id?: string;
  partner_name?: string;
  payment_method_id?: string;
  credit_date: string;
  sale_order_date: string; // The actual sale order date - primary date for calculations
  amount_total: number; // Total amount from "Total in Currency Signed" column
  currency: string;
  state: InvoiceState;
  reason?: string;
  notes?: string;
  imported_by?: string;
  imported_at: string;
  created_at: string;
}

export interface AccountingUpload {
  id: string;
  payment_method_id: string;
  total_amount: number;
  date_from: string;
  date_to: string;
  include_end_date: boolean;
  status: UploadStatus;
  created_by: string;
  created_at: string;
  submitted_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  admin_notes?: string;
  updated_at: string;
}

export interface UploadFile {
  id: string;
  upload_id: string;
  file_name: string;
  file_path: string;
  file_type: FileType;
  file_size_bytes: number;
  mime_type: string;
  rows_count?: number;
  columns_count?: number;
  preview_data?: any;
  uploaded_at: string;
  uploaded_by: string;
}

export interface AuditLog {
  id: string;
  action_type: AuditActionType;
  entity_type: AuditEntityType;
  entity_id?: string;
  performed_by?: string;
  ip_address?: string;
  user_agent?: string;
  old_values?: any;
  new_values?: any;
  description?: string;
  created_at: string;
}

export interface NotificationEmail {
  id: string;
  email: string;
  notification_type: 'upload_submitted' | 'upload_approved' | 'upload_rejected' | 'all';
  is_active: boolean;
  created_by?: string;
  created_at: string;
}

// Extended Types with Relations
export interface AccountingUploadWithDetails extends AccountingUpload {
  payment_method?: PaymentMethod;
  creator?: UserProfile;
  reviewer?: UserProfile;
  files?: UploadFile[];
}

export interface InvoiceWithDetails extends Invoice {
  payment_method?: PaymentMethod;
  importer?: UserProfile;
}

export interface DashboardSummary {
  payment_method_id: string;
  payment_method: string;
  month: string;
  total_invoices: number;
  total_credits: number;
  net_sales: number;
  approved_deductions: number;
  net_after_deduction: number;
}

export interface NetSalesView {
  invoice_id: string;
  invoice_number: string;
  payment_method_id: string;
  payment_method_name: string;
  invoice_date: string;
  invoice_amount: number;
  credit_amount: number;
  net_amount: number;
}

// Form Types
export interface UploadFormData {
  payment_method_id: string;
  total_amount: number;
  date_from: string;
  date_to: string;
  include_end_date: boolean;
  files: File[];
}

export interface InvoiceImportRow {
  invoice_number: string;
  partner_name?: string;
  payment_method_code?: string;
  invoice_date: string;
  due_date?: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  invoice_type: InvoiceType;
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Filter Types
export interface UploadFilters {
  status?: UploadStatus[];
  payment_method_id?: string[];
  date_from?: string;
  date_to?: string;
  created_by?: string;
}

export interface InvoiceFilters {
  payment_method_id?: string[];
  date_from?: string;
  date_to?: string;
  invoice_type?: InvoiceType;
  state?: InvoiceState;
}

export interface DashboardFilters {
  payment_method_id?: string[];
  date_from?: string;
  date_to?: string;
  include_end_date?: boolean;
}

// Chart Data Types
export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

export interface SalesTrendData {
  date: string;
  invoices: number;
  credits: number;
  net: number;
}

export interface PaymentMethodDistribution {
  payment_method: string;
  amount: number;
  percentage: number;
}

// Stat Card Types
export interface StatCard {
  title: string;
  value: number | string;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  icon?: any;
  color?: string;
}
// Deposits Feature Types
export type TaxCalculationMethod = 'fixed_percent' | 'fixed_amount' | 'column_based' | 'none';

export interface DepositSettings {
  id?: string;
  payment_method_id: string;
  // Standardized naming: use _name suffix throughout the app
  filter_column_name?: string;
  filter_include_values?: string[];
  filter_column_name2?: string;
  filter_include_values2?: string[];
  filter_column_name3?: string;
  filter_include_values3?: string[];
  filter_column_name4?: string;
  filter_include_values4?: string[];
  amount_column_name: string;
  refund_column_name?: string;
  tax_enabled: boolean;
  tax_method: TaxCalculationMethod;
  tax_value?: number; // for fixed_percent or fixed_amount
  tax_column_name?: string; // for column_based
  header_row_index?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DepositCalculation {
  totalAmount: number;
  totalRefunds: number;
  netAmount: number;
  taxAmount: number;
  finalAmount: number;
  rowsAfterFilter: number;
}

export interface DepositConfig {
  paymentMethodId: string;
  startDate: string;
  endDate: string;
  filterColumn?: string;
  filterValues?: string[];
  amountColumn: string;
  refundColumn?: string;
  taxEnabled: boolean;
  taxMethod: TaxCalculationMethod;
  taxValue?: number;
  taxColumn?: string;
}

export interface DepositFileData {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
}
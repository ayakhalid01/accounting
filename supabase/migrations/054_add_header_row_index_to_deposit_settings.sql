-- Accounting Reconciliation System - Database Schema
-- Migration: 054_add_header_row_index_to_deposit_settings
-- Created: 2025-12-24
-- Description: Add header_row_index column to payment_method_deposit_settings table

-- Add header_row_index column to payment_method_deposit_settings
ALTER TABLE payment_method_deposit_settings
ADD COLUMN IF NOT EXISTS header_row_index INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN payment_method_deposit_settings.header_row_index IS 'Which row contains column headers (0-based index). Default is 0 (first row).';

-- Update existing records to have header_row_index = 0 if null
UPDATE payment_method_deposit_settings
SET header_row_index = 0
WHERE header_row_index IS NULL;
-- Add additional filter columns to deposit settings
ALTER TABLE payment_method_deposit_settings
ADD COLUMN IF NOT EXISTS filter_column_name2 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values2 TEXT[],
ADD COLUMN IF NOT EXISTS filter_column_name3 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values3 TEXT[],
ADD COLUMN IF NOT EXISTS filter_column_name4 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values4 TEXT[];

-- Update the deposits table to also store these additional filter columns
ALTER TABLE deposits
ADD COLUMN IF NOT EXISTS filter_column_name2 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values2 TEXT[],
ADD COLUMN IF NOT EXISTS filter_column_name3 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values3 TEXT[],
ADD COLUMN IF NOT EXISTS filter_column_name4 TEXT,
ADD COLUMN IF NOT EXISTS filter_include_values4 TEXT[];
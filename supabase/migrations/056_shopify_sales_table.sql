-- Create shopify_sales table for Shopify Point of Sale transactions
CREATE TABLE IF NOT EXISTS shopify_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT,
  day DATE NOT NULL,
  order_name TEXT NOT NULL,
  payment_gateway TEXT NOT NULL,
  pos_location_name TEXT,
  order_sales_channel TEXT,
  pos_register_id TEXT,
  gross_payments NUMERIC(15,2) DEFAULT 0,
  refunded_payments NUMERIC(15,2) DEFAULT 0,
  net_payments NUMERIC(15,2) DEFAULT 0,
  -- Grouping fields for aggregation (computed on insert, not generated)
  group_key TEXT,
  -- Metadata
  imported_by UUID REFERENCES auth.users(id),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_shopify_sales_day ON shopify_sales(day);
CREATE INDEX IF NOT EXISTS idx_shopify_sales_payment_gateway ON shopify_sales(payment_gateway);
CREATE INDEX IF NOT EXISTS idx_shopify_sales_order_name ON shopify_sales(order_name);
CREATE INDEX IF NOT EXISTS idx_shopify_sales_order_sales_channel ON shopify_sales(order_sales_channel);
CREATE INDEX IF NOT EXISTS idx_shopify_sales_group_key ON shopify_sales(group_key);

-- Create aggregated view for grouped data
CREATE OR REPLACE VIEW shopify_sales_grouped AS
SELECT 
  day,
  order_name,
  payment_gateway,
  pos_location_name,
  order_sales_channel,
  SUM(gross_payments) as total_gross,
  SUM(refunded_payments) as total_refunded,
  SUM(net_payments) as total_net,
  COUNT(*) as transaction_count
FROM shopify_sales
GROUP BY day, order_name, payment_gateway, pos_location_name, order_sales_channel;

-- RLS Policies
ALTER TABLE shopify_sales ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all shopify sales
CREATE POLICY "Allow authenticated users to read shopify_sales"
ON shopify_sales FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert shopify sales
CREATE POLICY "Allow authenticated users to insert shopify_sales"
ON shopify_sales FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update shopify sales
CREATE POLICY "Allow authenticated users to update shopify_sales"
ON shopify_sales FOR UPDATE
TO authenticated
USING (true);

-- Allow authenticated users to delete shopify sales
CREATE POLICY "Allow authenticated users to delete shopify_sales"
ON shopify_sales FOR DELETE
TO authenticated
USING (true);

-- Function to delete all shopify sales (for bulk operations)
CREATE OR REPLACE FUNCTION delete_all_shopify_sales()
RETURNS TABLE(deleted_count INTEGER) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_deleted INTEGER;
BEGIN
  DELETE FROM shopify_sales;
  GET DIAGNOSTICS count_deleted = ROW_COUNT;
  RETURN QUERY SELECT count_deleted;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION delete_all_shopify_sales() TO authenticated;

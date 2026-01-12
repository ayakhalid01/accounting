-- Function to get Shopify sales statistics with filters
CREATE OR REPLACE FUNCTION get_shopify_stats(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_payment_gateway TEXT DEFAULT NULL,
  p_order_sales_channel TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_records BIGINT,
  total_gross NUMERIC,
  total_refunded NUMERIC,
  total_net NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_records,
    COALESCE(SUM(gross_payments), 0) as total_gross,
    COALESCE(SUM(refunded_payments), 0) as total_refunded,
    COALESCE(SUM(net_payments), 0) as total_net
  FROM shopify_sales
  WHERE 
    (p_date_from IS NULL OR day >= p_date_from)
    AND (p_date_to IS NULL OR day <= p_date_to)
    AND (p_payment_gateway IS NULL OR p_payment_gateway = '' OR payment_gateway = p_payment_gateway)
    AND (p_order_sales_channel IS NULL OR p_order_sales_channel = '' OR order_sales_channel = p_order_sales_channel)
    AND (p_search IS NULL OR p_search = '' OR order_name ILIKE '%' || p_search || '%');
END;
$$;

-- Function to get distinct payment gateways
CREATE OR REPLACE FUNCTION get_shopify_payment_gateways()
RETURNS TABLE(payment_gateway TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT s.payment_gateway
  FROM shopify_sales s
  WHERE s.payment_gateway IS NOT NULL AND s.payment_gateway != ''
  ORDER BY s.payment_gateway;
END;
$$;

-- Function to get distinct order sales channels
CREATE OR REPLACE FUNCTION get_shopify_sales_channels()
RETURNS TABLE(order_sales_channel TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT s.order_sales_channel
  FROM shopify_sales s
  WHERE s.order_sales_channel IS NOT NULL AND s.order_sales_channel != ''
  ORDER BY s.order_sales_channel;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_shopify_stats(DATE, DATE, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shopify_payment_gateways() TO authenticated;
GRANT EXECUTE ON FUNCTION get_shopify_sales_channels() TO authenticated;

-- Create RPC function for fast deletion
-- This is much faster than REST API batch deletion

CREATE OR REPLACE FUNCTION delete_all_records(table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow deletion from specific tables for security
  IF table_name NOT IN ('invoices', 'credit_notes') THEN
    RAISE EXCEPTION 'Invalid table name';
  END IF;
  
  -- Delete all records from the specified table
  EXECUTE format('DELETE FROM %I WHERE imported_by = auth.uid()', table_name);
  
  -- Or to delete ALL records (be careful!):
  -- EXECUTE format('DELETE FROM %I', table_name);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_all_records(text) TO authenticated;

COMMENT ON FUNCTION delete_all_records IS 'Fast deletion of all records from invoices or credit_notes tables';

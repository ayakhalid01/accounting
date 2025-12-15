-- Function to delete all invoices and related credits efficiently
create or replace function delete_all_invoices()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_credits_deleted int;
  v_invoices_deleted int;
begin
  -- Increase statement timeout for large deletions (60 seconds)
  set statement_timeout = '120s';
  
  -- First delete all related credits (foreign key constraint)
  delete from credit_notes where true;
  get diagnostics v_credits_deleted = row_count;
  
  -- Then delete all invoices
  delete from invoices where true;
  get diagnostics v_invoices_deleted = row_count;
  
  return jsonb_build_object(
    'credits_deleted', v_credits_deleted,
    'invoices_deleted', v_invoices_deleted,
    'success', true
  );
end;
$$;

-- Function to delete all credits efficiently
create or replace function delete_all_credits()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_credits_deleted int;
begin
  -- Increase statement timeout for large deletions (60 seconds)
  set statement_timeout = '120s';
  
  delete from credit_notes where true;
  get diagnostics v_credits_deleted = row_count;
  
  return jsonb_build_object(
    'credits_deleted', v_credits_deleted,
    'success', true
  );
end;
$$;

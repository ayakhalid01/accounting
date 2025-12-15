-- Check invoices on Dec 10, 2025
SELECT 
  'Invoice' as type,
  invoice_number as number,
  sale_order_date,
  invoice_date,
  amount_total,
  state
FROM invoices
WHERE sale_order_date::DATE = '2025-12-10'
  AND payment_method_id = 'b6510f6e-8d55-43ea-ab49-697867028814'
ORDER BY sale_order_date;

-- Also check if there are invoices at end of Dec 9 (timezone issue)
SELECT 
  'Invoice (Dec 9)' as type,
  invoice_number as number,
  sale_order_date,
  invoice_date,
  amount_total,
  state
FROM invoices
WHERE sale_order_date >= '2025-12-09 22:00:00'
  AND sale_order_date < '2025-12-10 02:00:00'
  AND payment_method_id = 'b6510f6e-8d55-43ea-ab49-697867028814'
ORDER BY sale_order_date;

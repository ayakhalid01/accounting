-- Check deposit allocations for Dec 10
SELECT 
  allocation_date,
  deposit_id,
  daily_sales,
  allocated_amount
FROM deposit_allocations
WHERE allocation_date = '2025-12-10'
  AND payment_method_id = 'b6510f6e-8d55-43ea-ab49-697867028814'
ORDER BY allocation_date;

-- Check the deposit details
SELECT 
  d.id,
  d.start_date,
  d.end_date,
  d.net_amount,
  d.status
FROM deposits d
WHERE d.id IN (
  SELECT DISTINCT deposit_id 
  FROM deposit_allocations 
  WHERE allocation_date = '2025-12-10'
    AND payment_method_id = 'b6510f6e-8d55-43ea-ab49-697867028814'
);

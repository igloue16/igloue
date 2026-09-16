begin;

select plan(6);

-- Create the product required by the reservation foreign key.
insert into public.products (
  id,
  name,
  weekly_price,
  deposit_amount,
  active
)
values (
  'essential',
  'Essential',
  59,
  250,
  true
)
on conflict (id) do nothing;

-- Create one complete reservation transaction.
select *
from public.create_reservation_transaction(
  'Test',
  'Customer',
  'transaction-test@example.com',
  '0600000000',
  'essential',
  '2026-09-20 12:00:00+00',
  '2026-09-23 12:00:00+00',
  '10 Rue Exemple',
  null,
  '16000',
  'Angouleme',
  'local',
  59,
  29,
  19,
  250,
  73.29,
  '2026-09-20',
  'morning',
  '2026-09-23',
  'afternoon'
);

select is(
  (
    select count(*)::integer
    from public.customers
    where email = 'transaction-test@example.com'
  ),
  1,
  'creates exactly one customer'
);

select is(
  (
    select count(*)::integer
    from public.reservations r
    join public.customers c on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
  ),
  1,
  'creates exactly one reservation'
);

select is(
  (
    select r.status
    from public.reservations r
    join public.customers c on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
  ),
  'pending',
  'reservation starts as pending'
);

select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r on r.id = j.reservation_id
    join public.customers c on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
  ),
  2,
  'creates exactly two service jobs'
);

select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r on r.id = j.reservation_id
    join public.customers c on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
      and j.job_type = 'delivery'
  ),
  1,
  'creates one delivery job'
);

select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r on r.id = j.reservation_id
    join public.customers c on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
      and j.job_type = 'collection'
  ),
  1,
  'creates one collection job'
);

select * from finish();

rollback;
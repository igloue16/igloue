begin;

select plan(10);

-- Product required by the reservation foreign key.
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


-- First request: this should create the booking.
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
  'afternoon',
  'test-booking-key-001'
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
    join public.customers c
      on c.id = r.customer_id
    where c.email = 'transaction-test@example.com'
  ),
  1,
  'creates exactly one reservation'
);


select is(
  (
    select r.status
    from public.reservations r
    where r.idempotency_key = 'test-booking-key-001'
  ),
  'pending',
  'reservation starts as pending'
);


select is(
  (
    select r.idempotency_key
    from public.reservations r
    where r.idempotency_key = 'test-booking-key-001'
  ),
  'test-booking-key-001',
  'stores the idempotency key'
);


select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r
      on r.id = j.reservation_id
    where r.idempotency_key = 'test-booking-key-001'
  ),
  2,
  'creates exactly two service jobs'
);


select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r
      on r.id = j.reservation_id
    where r.idempotency_key = 'test-booking-key-001'
      and j.job_type = 'delivery'
  ),
  1,
  'creates one delivery job'
);


select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r
      on r.id = j.reservation_id
    where r.idempotency_key = 'test-booking-key-001'
      and j.job_type = 'collection'
  ),
  1,
  'creates one collection job'
);


-- Retry the exact same booking submission using the same idempotency key.
-- This must return the existing booking rather than create another one.
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
  'afternoon',
  'test-booking-key-001'
);


select is(
  (
    select count(*)::integer
    from public.customers
    where email = 'transaction-test@example.com'
  ),
  1,
  'retry does not create another customer'
);


select is(
  (
    select count(*)::integer
    from public.reservations
    where idempotency_key = 'test-booking-key-001'
  ),
  1,
  'retry does not create another reservation'
);


select is(
  (
    select count(*)::integer
    from public.service_jobs j
    join public.reservations r
      on r.id = j.reservation_id
    where r.idempotency_key = 'test-booking-key-001'
  ),
  2,
  'retry does not create duplicate service jobs'
);


select * from finish();

rollback;
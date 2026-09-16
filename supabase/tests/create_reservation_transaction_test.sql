begin;

select plan(14);

-- Product required by the reservation and machine foreign keys.
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

-- Physical machine available for the atomic booking hold.
insert into public.physical_machines (
    id,
    product_id,
    serial_number,
    status,
    active
)
values (
    'TEST-TX-001',
    'essential',
    'TEST-TX-SERIAL-001',
    'available',
    true
);

-- First request:
-- Customer + reservation + service jobs + machine hold
-- must all be created in one transaction.
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
    '0830-1030',
    '2026-09-23',
    '1630-1830',
    'test-booking-key-001',
    '2026-09-20 06:30:00',
    '2026-09-23 22:30:00'
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

select is(
    (
        select count(*)::integer
        from public.allocations a
        join public.reservations r
          on r.id = a.reservation_id
        where r.idempotency_key = 'test-booking-key-001'
          and a.status = 'held'
    ),
    1,
    'creates exactly one machine hold'
);

select is(
    (
        select a.machine_id
        from public.allocations a
        join public.reservations r
          on r.id = a.reservation_id
        where r.idempotency_key = 'test-booking-key-001'
          and a.status = 'held'
    ),
    'TEST-TX-001',
    'holds the eligible physical machine'
);

-- Europe/Paris is UTC+2 on 20 September 2026.
-- 06:30 French civil time must therefore be stored as 04:30 UTC.
select is(
    (
        select a.operational_start
        from public.allocations a
        join public.reservations r
          on r.id = a.reservation_id
        where r.idempotency_key = 'test-booking-key-001'
          and a.status = 'held'
    ),
    '2026-09-20 04:30:00+00'::timestamptz,
    'converts operational start from Europe/Paris to the correct instant'
);

-- 22:30 French civil time is 20:30 UTC on this date.
select is(
    (
        select a.operational_end
        from public.allocations a
        join public.reservations r
          on r.id = a.reservation_id
        where r.idempotency_key = 'test-booking-key-001'
          and a.status = 'held'
    ),
    '2026-09-23 20:30:00+00'::timestamptz,
    'converts operational end from Europe/Paris to the correct instant'
);

-- Retry the exact same submission.
-- It must return the existing booking and allocation.
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
    '0830-1030',
    '2026-09-23',
    '1630-1830',
    'test-booking-key-001',
    '2026-09-20 06:30:00',
    '2026-09-23 22:30:00'
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
        from public.allocations a
        join public.reservations r
          on r.id = a.reservation_id
        where r.idempotency_key = 'test-booking-key-001'
          and a.status in ('held', 'reserved', 'active')
    ),
    1,
    'retry does not create another machine hold'
);

select * from finish();

rollback;
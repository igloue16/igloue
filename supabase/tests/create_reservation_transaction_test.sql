begin;

select plan(41);

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

insert into public.physical_machines (
    id,
    product_id,
    serial_number,
    status,
    active
)
values (
    'TEST-TX-002',
    'essential',
    'TEST-TX-SERIAL-002',
    'available',
    true
);

-- First request:
-- Customer + reservation + service jobs + machine hold
-- must all be created in one transaction.
create temporary table tx_first as
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

select is((select reservation_status from tx_first), 'pending', 'RPC returns authoritative pending status');
select ok((select hold_expires_at is not null from tx_first), 'RPC returns authoritative hold expiry');

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
create temporary table tx_retry as
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

select is((select reservation_status from tx_retry), 'pending', 'idempotent retry returns current pending status');
select is((select hold_expires_at from tx_retry), (select hold_expires_at from tx_first), 'idempotent retry preserves authoritative hold expiry');
select is((select reservation_id from tx_retry), (select reservation_id from tx_first), 'pending retry returns the original reservation');
select is((select allocation_id from tx_retry), (select allocation_id from tx_first), 'pending retry returns the original allocation');
select is((select machine_id from tx_retry), (select machine_id from tx_first), 'pending retry returns the original machine');

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

select throws_ok($$ select * from public.create_reservation_transaction(
    'Test', 'Customer', 'transaction-test@example.com', '0600000000',
    'mobile-duo', '2026-09-20 12:00:00+00', '2026-09-23 12:00:00+00',
    '10 Rue Exemple', null, '16000', 'Angouleme', 'local',
    79, 29, 19, 350, 77.29, '2026-09-20', '0830-1030',
    '2026-09-23', '1630-1830', 'test-booking-key-001',
    '2026-09-20 06:30:00', '2026-09-23 22:30:00'
) $$, 'P0003', null, 'mismatched idempotent payload is rejected');

select is((select count(*)::integer from public.reservations where idempotency_key = 'test-booking-key-001'), 1, 'mismatched retry keeps one reservation');
select is((select count(*)::integer from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'test-booking-key-001'), 1, 'mismatched retry keeps one allocation');
select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'test-booking-key-001'), 2, 'mismatched retry keeps two service jobs');

select * from public.confirm_reservation((select reservation_id from tx_first));
create temporary table tx_confirmed as
select * from public.create_reservation_transaction(
    'Test', 'Customer', 'transaction-test@example.com', '0600000000',
    'essential', '2026-09-20 12:00:00+00', '2026-09-23 12:00:00+00',
    '10 Rue Exemple', null, '16000', 'Angouleme', 'local',
    59, 29, 19, 250, 73.29, '2026-09-20', '0830-1030',
    '2026-09-23', '1630-1830', 'test-booking-key-001',
    '2026-09-20 06:30:00', '2026-09-23 22:30:00'
);
select is((select reservation_status from tx_confirmed), 'confirmed', 'confirmed retry returns current status');
select ok((select hold_expires_at is null from tx_confirmed), 'confirmed retry returns no active hold expiry');
select is((select reservation_id from tx_confirmed), (select reservation_id from tx_first), 'confirmed retry returns same reservation');
select is((select allocation_id from tx_confirmed), (select allocation_id from tx_first), 'confirmed retry returns same allocation');
select is((select machine_id from tx_confirmed), (select machine_id from tx_first), 'confirmed retry returns same machine');
select is((select count(*)::integer from public.reservations where idempotency_key = 'test-booking-key-001'), 1, 'confirmed retry keeps one reservation');
select is((select count(*)::integer from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'test-booking-key-001'), 1, 'confirmed retry keeps one allocation');
select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'test-booking-key-001'), 2, 'confirmed retry keeps two service jobs');

create temporary table tx_cancelled as
select * from public.create_reservation_transaction(
    'Second', 'Customer', 'transaction-cancelled@example.com', '0600000001',
    'essential', '2026-09-25 12:00:00+00', '2026-09-28 12:00:00+00',
    '10 Rue Exemple', null, '16000', 'Angouleme', 'local',
    59, 29, 19, 250, 73.29, '2026-09-25', '0830-1030',
    '2026-09-28', '1630-1830', 'test-cancelled-key-001',
    '2026-09-25 06:30:00', '2026-09-28 22:30:00'
);
update public.allocations
set hold_expires_at = now() - interval '1 minute'
where id = (select allocation_id from tx_cancelled);
select * from public.expire_reservation_hold((select reservation_id from tx_cancelled));
create temporary table tx_cancelled_retry as
select * from public.create_reservation_transaction(
    'Second', 'Customer', 'transaction-cancelled@example.com', '0600000001',
    'essential', '2026-09-25 12:00:00+00', '2026-09-28 12:00:00+00',
    '10 Rue Exemple', null, '16000', 'Angouleme', 'local',
    59, 29, 19, 250, 73.29, '2026-09-25', '0830-1030',
    '2026-09-28', '1630-1830', 'test-cancelled-key-001',
    '2026-09-25 06:30:00', '2026-09-28 22:30:00'
);
select is((select reservation_status from tx_cancelled_retry), 'cancelled', 'cancelled retry returns current status');
select ok((select hold_expires_at is null from tx_cancelled_retry), 'cancelled retry returns no hold expiry');
select is((select reservation_id from tx_cancelled_retry), (select reservation_id from tx_cancelled), 'cancelled retry returns same reservation');
select ok((select allocation_id is null from tx_cancelled_retry), 'cancelled retry returns no active allocation');
select ok((select machine_id is null from tx_cancelled_retry), 'cancelled retry returns no active machine');
select is((select count(*)::integer from public.reservations where idempotency_key = 'test-cancelled-key-001'), 1, 'cancelled retry does not create another reservation');
select is((select count(*)::integer from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'test-cancelled-key-001'), 1, 'cancelled retry keeps one historical allocation');
select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'test-cancelled-key-001'), 2, 'cancelled retry keeps two historical service jobs');

select * from finish();

rollback;

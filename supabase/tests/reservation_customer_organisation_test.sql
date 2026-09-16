begin;

select plan(9);

insert into public.physical_machines (
    id,
    product_id,
    serial_number,
    status,
    active
)
values (
    'TEST-B3-ORG-001',
    'essential',
    'TEST-B3-ORG-SERIAL-001',
    'available',
    true
)
on conflict (id) do nothing;

create temporary table batch3_first_result as
select *
from public.create_reservation_transaction(
    'Batch3',
    'Organisation',
    'batch3-organisation@example.com',
    '0600000000',
    'essential',
    '2026-10-20 12:00:00+00',
    '2026-10-23 12:00:00+00',
    '10 Rue Batch3',
    null,
    '16000',
    'Angouleme',
    'local',
    59,
    29,
    19,
    250,
    73.29,
    '2026-10-20',
    '0830-1030',
    '2026-10-23',
    '1630-1830',
    'batch3-organisation-key-001',
    '2026-10-20 06:30:00',
    '2026-10-23 22:30:00'
);

select is(
    (
        select c.organisation_id
        from public.customers as c
        where c.email = 'batch3-organisation@example.com'
    ),
    (select id from public.organisations where slug = 'igloue'),
    'new transaction customer belongs to IGLOUE'
);

select ok(
    exists (
        select 1
        from public.reservations as r
        join public.customers as c on c.id = r.customer_id
        where r.idempotency_key = 'batch3-organisation-key-001'
          and c.email = 'batch3-organisation@example.com'
    ),
    'reservation references the organisation-owned customer'
);

select is(
    (select customer_id from batch3_first_result),
    (
        select id from public.customers
        where email = 'batch3-organisation@example.com'
    ),
    'initial result returns the created customer'
);

create temporary table batch3_retry_result as
select *
from public.create_reservation_transaction(
    'Batch3', 'Organisation', 'batch3-organisation@example.com',
    '0600000000', 'essential', '2026-10-20 12:00:00+00',
    '2026-10-23 12:00:00+00', '10 Rue Batch3', null, '16000',
    'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2026-10-20',
    '0830-1030', '2026-10-23', '1630-1830',
    'batch3-organisation-key-001', '2026-10-20 06:30:00',
    '2026-10-23 22:30:00'
);

select is(
    (select customer_id from batch3_retry_result),
    (select customer_id from batch3_first_result),
    'retry returns the same customer'
);

select is(
    (
        select count(*)::integer
        from public.customers
        where email = 'batch3-organisation@example.com'
    ),
    1,
    'retry does not create another customer'
);

select is(
    (
        select c.organisation_id
        from public.customers as c
        where c.email = 'batch3-organisation@example.com'
    ),
    (select id from public.organisations where slug = 'igloue'),
    'organisation ownership is unchanged on retry'
);

update public.organisations
set slug = 'igloue-batch3-hidden'
where slug = 'igloue';

select throws_ok(
    $$
        select *
        from public.create_reservation_transaction(
            'Batch3', 'Failure', 'batch3-failure@example.com',
            '0600000001', 'essential', '2026-11-20 12:00:00+00',
            '2026-11-23 12:00:00+00', '10 Rue Batch3', null, '16000',
            'Angouleme', 'local', 59, 29, 19, 250, 73.29,
            '2026-11-20', '0830-1030', '2026-11-23', '1630-1830',
            'batch3-failure-key-001', '2026-11-20 06:30:00',
            '2026-11-23 22:30:00'
        )
    $$,
    'P0001',
    'IGLOUE organisation not found',
    'missing IGLOUE organisation aborts creation'
);

select ok(
    not exists (
        select 1 from public.customers
        where email = 'batch3-failure@example.com'
    )
    and not exists (
        select 1 from public.reservations
        where idempotency_key = 'batch3-failure-key-001'
    )
    and not exists (
        select 1
        from public.service_jobs as j
        join public.reservations as r on r.id = j.reservation_id
        where r.idempotency_key = 'batch3-failure-key-001'
    )
    and not exists (
        select 1
        from public.allocations as a
        join public.reservations as r on r.id = a.reservation_id
        where r.idempotency_key = 'batch3-failure-key-001'
    ),
    'failed creation leaves no partial records'
);

update public.organisations
set slug = 'igloue'
where slug = 'igloue-batch3-hidden';

select is(
    (select count(*)::integer from public.organisations where slug = 'igloue'),
    1,
    'IGLOUE bootstrap slug is restored'
);

select * from finish();

rollback;

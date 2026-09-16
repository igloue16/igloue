begin;

select plan(24);

select ok(
    exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'organisation_id'
    ),
    'reservations.organisation_id exists'
);

select is(
    (
        select udt_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'organisation_id'
    ),
    'uuid',
    'reservations.organisation_id is uuid'
);

select ok(
    coalesce((
        select is_nullable = 'YES'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'organisation_id'
    ), false),
    'reservations.organisation_id remains nullable in Batch 6'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and contype = 'f'
          and confrelid = 'public.organisations'::regclass
          and conkey = array[
              (select attnum from pg_attribute
               where attrelid = 'public.reservations'::regclass
                 and attname = 'organisation_id' and not attisdropped)
          ]::smallint[]
    ),
    'reservation organisation_id references organisations(id)'
);

select ok(
    exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'reservations'
          and indexdef ilike '%(organisation_id)%'
    ),
    'reservations has an organisation_id index'
);

select ok(
    (select relrowsecurity from pg_class
     where oid = 'public.reservations'::regclass),
    'reservations RLS remains enabled'
);

select ok(
    has_table_privilege('service_role', 'public.reservations', 'SELECT'),
    'service_role can select reservations'
);

select ok(
    has_table_privilege('service_role', 'public.reservations', 'INSERT'),
    'service_role can insert reservations'
);

select ok(
    not has_table_privilege('anon', 'public.reservations', 'UPDATE'),
    'anon reservation update privilege remains restricted'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('B6-ORG-MACHINE', 'essential', 'B6-ORG-SERIAL', 'available', true);

create temporary table batch6_first_result as
select *
from public.create_reservation_transaction(
    'Batch6', 'Organisation', 'batch6-organisation@example.com', '0600000006',
    'essential', '2026-12-10 12:00:00+00', '2026-12-13 12:00:00+00',
    '6 Rue Batch6', null, '16000', 'Angouleme', 'local',
    59, 29, 19, 250, 73.29, '2026-12-10', '0830-1030',
    '2026-12-13', '1630-1830', 'batch6-organisation-key-001',
    '2026-12-10 06:30:00', '2026-12-13 22:30:00'
);

select is(
    (select r.organisation_id from public.reservations r
     where r.idempotency_key = 'batch6-organisation-key-001'),
    (select c.organisation_id from public.customers c
     where c.email = 'batch6-organisation@example.com'),
    'new reservation ownership matches its customer'
);

select is(
    (select o.slug from public.organisations o
     join public.reservations r on r.organisation_id = o.id
     where r.idempotency_key = 'batch6-organisation-key-001'),
    'igloue',
    'new reservation belongs to IGLOUE in V1'
);

select is(
    (select reservation_id from batch6_first_result),
    (select id from public.reservations
     where idempotency_key = 'batch6-organisation-key-001'),
    'initial result returns the created reservation'
);

create temporary table batch6_retry_result as
select *
from public.create_reservation_transaction(
    'Batch6', 'Organisation', 'batch6-organisation@example.com', '0600000006',
    'essential', '2026-12-10 12:00:00+00', '2026-12-13 12:00:00+00',
    '6 Rue Batch6', null, '16000', 'Angouleme', 'local',
    59, 29, 19, 250, 73.29, '2026-12-10', '0830-1030',
    '2026-12-13', '1630-1830', 'batch6-organisation-key-001',
    '2026-12-10 06:30:00', '2026-12-13 22:30:00'
);

select is(
    (select reservation_id from batch6_retry_result),
    (select reservation_id from batch6_first_result),
    'idempotent retry returns the same reservation'
);

select is(
    (select customer_id from batch6_retry_result),
    (select customer_id from batch6_first_result),
    'idempotent retry returns the same customer'
);

select is(
    (select count(*)::integer from public.reservations
     where idempotency_key = 'batch6-organisation-key-001'),
    1,
    'idempotent retry creates no duplicate reservation'
);

select is(
    (select count(*)::integer from public.customers
     where email = 'batch6-organisation@example.com'),
    1,
    'idempotent retry creates no duplicate customer'
);

select is(
    (select r.organisation_id from public.reservations r
     where r.idempotency_key = 'batch6-organisation-key-001'),
    (select c.organisation_id from public.customers c
     where c.email = 'batch6-organisation@example.com'),
    'ownership remains unchanged on valid retry'
);

select is(
    (select count(*)::integer from public.service_jobs j
     join public.reservations r on r.id = j.reservation_id
     where r.idempotency_key = 'batch6-organisation-key-001'),
    2,
    'reservation still creates delivery and collection jobs'
);

select ok(
    exists (select 1 from public.allocations a
            join public.reservations r on r.id = a.reservation_id
            where r.idempotency_key = 'batch6-organisation-key-001'),
    'reservation still creates a machine allocation'
);

insert into public.organisations (slug, name)
values ('batch6-other', 'Batch 6 Other');

select throws_ok(
    $$
        update public.reservations
        set organisation_id = (select id from public.organisations where slug = 'batch6-other')
        where idempotency_key = 'batch6-organisation-key-001'
    $$,
    '23503',
    null,
    'database rejects a reservation/customer organisation mismatch'
);

update public.reservations
set organisation_id = null
where idempotency_key = 'batch6-organisation-key-001';

select throws_ok(
    $$ select * from public.create_reservation_transaction(
        'Batch6', 'Organisation', 'batch6-organisation@example.com', '0600000006',
        'essential', '2026-12-10 12:00:00+00', '2026-12-13 12:00:00+00',
        '6 Rue Batch6', null, '16000', 'Angouleme', 'local', 59, 29, 19,
        250, 73.29, '2026-12-10', '0830-1030', '2026-12-13', '1630-1830',
        'batch6-organisation-key-001', '2026-12-10 06:30:00',
        '2026-12-13 22:30:00') $$,
    'P0001', null,
    'retry rejects NULL reservation ownership'
);

select is(
    (select count(*)::integer from public.reservations
     where idempotency_key = 'batch6-organisation-key-001'),
    1,
    'failed ownership checks create no additional reservation'
);

select is(
    (select count(*)::integer from public.customers
     where email = 'batch6-organisation@example.com'),
    1,
    'failed ownership checks create no additional customer'
);

select ok(
    (select count(*)::integer from public.service_jobs j
     join public.reservations r on r.id = j.reservation_id
     where r.idempotency_key = 'batch6-organisation-key-001') = 2
    and (select count(*)::integer from public.allocations a
         join public.reservations r on r.id = a.reservation_id
         where r.idempotency_key = 'batch6-organisation-key-001') = 1,
    'failed ownership checks create no partial jobs or allocations'
);

select * from finish();

rollback;

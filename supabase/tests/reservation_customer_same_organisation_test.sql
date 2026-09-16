begin;

select plan(16);

select ok(
    exists (
        select 1 from pg_constraint
        where conrelid = 'public.customers'::regclass
          and conname = 'customers_id_organisation_id_key'
          and contype = 'u'
          and conkey = array[
              (select attnum from pg_attribute where attrelid = 'public.customers'::regclass and attname = 'id'),
              (select attnum from pg_attribute where attrelid = 'public.customers'::regclass and attname = 'organisation_id')
          ]::smallint[]
    ),
    'customers has the expected composite unique constraint'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname = 'reservations_customer_organisation_fkey'
          and contype = 'f'
          and confrelid = 'public.customers'::regclass
          and conkey = array[
              (select attnum from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'customer_id'),
              (select attnum from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'organisation_id')
          ]::smallint[]
          and confkey = array[
              (select attnum from pg_attribute where attrelid = 'public.customers'::regclass and attname = 'id'),
              (select attnum from pg_attribute where attrelid = 'public.customers'::regclass and attname = 'organisation_id')
          ]::smallint[]
    ),
    'reservations has the expected composite customer foreign key'
);

select ok(
    exists (select 1 from pg_constraint
            where conrelid = 'public.reservations'::regclass
              and contype = 'f'
              and conkey = array[(select attnum from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'customer_id')]::smallint[]
              and confrelid = 'public.customers'::regclass),
    'existing reservation customer foreign key remains'
);

select ok(
    exists (select 1 from pg_constraint
            where conrelid = 'public.reservations'::regclass
              and contype = 'f'
              and conkey = array[(select attnum from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'organisation_id')]::smallint[]
              and confrelid = 'public.organisations'::regclass),
    'existing reservation organisation foreign key remains'
);

select ok(
    coalesce((select is_nullable = 'YES' from information_schema.columns
              where table_schema = 'public' and table_name = 'reservations'
                and column_name = 'organisation_id'), false),
    'reservations.organisation_id remains nullable'
);

select ok(
    exists (select 1 from pg_indexes where schemaname = 'public'
            and tablename = 'reservations'
            and indexname = 'reservations_organisation_id_idx'),
    'reservation organisation index remains present'
);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-0000-0000-000000000701',
    (select id from public.organisations where slug = 'igloue'),
    'Batch7', 'Direct', 'batch7-direct@example.com'
);

select lives_ok(
    $$
        insert into public.reservations (
            id, organisation_id, customer_id, product_id, rental_start, rental_end,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000000701',
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000000701', 'essential',
            '2027-01-01 10:00:00+00', '2027-01-04 10:00:00+00',
            '7 Rue Batch7', '16000', 'Angouleme', 59, 250, 59
        )
    $$,
    'valid same-organisation reservation succeeds'
);

insert into public.organisations (slug, name)
values ('batch7-other', 'Batch 7 Other');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-0000-0000-000000000702',
    (select id from public.organisations where slug = 'batch7-other'),
    'Batch7', 'Other', 'batch7-other@example.com'
);

select throws_ok(
    $$
        insert into public.reservations (
            id, organisation_id, customer_id, product_id, rental_start, rental_end,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000000702',
            (select id from public.organisations where slug = 'batch7-other'),
            '00000000-0000-0000-0000-000000000701', 'essential',
            '2027-01-05 10:00:00+00', '2027-01-08 10:00:00+00',
            '7 Rue Batch7', '16000', 'Angouleme', 59, 250, 59
        )
    $$,
    '23503', null,
    'mismatched customer and reservation organisation fails'
);

select lives_ok(
    $$
        insert into public.reservations (
            id, customer_id, product_id, rental_start, rental_end,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000000703',
            '00000000-0000-0000-0000-000000000701', 'essential',
            '2027-01-10 10:00:00+00', '2027-01-13 10:00:00+00',
            '7 Rue Batch7', '16000', 'Angouleme', 59, 250, 59
        )
    $$,
    'NULL reservation organisation remains permitted in Batch 7'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('B7-ORG-MACHINE', 'essential', 'B7-ORG-SERIAL', 'available', true);

create temporary table batch7_rpc_result as
select * from public.create_reservation_transaction(
    'Batch7', 'RPC', 'batch7-rpc@example.com', '0600000007', 'essential',
    '2027-02-10 12:00:00+00', '2027-02-13 12:00:00+00', '7 Rue Batch7', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-02-10',
    '0830-1030', '2027-02-13', '1630-1830', 'batch7-rpc-key-001',
    '2027-02-10 06:30:00', '2027-02-13 22:30:00'
);

select is(
    (select r.organisation_id from public.reservations r where r.idempotency_key = 'batch7-rpc-key-001'),
    (select c.organisation_id from public.customers c where c.email = 'batch7-rpc@example.com'),
    'RPC reservation ownership matches customer ownership'
);

select is(
    (select o.slug from public.organisations o join public.reservations r on r.organisation_id = o.id where r.idempotency_key = 'batch7-rpc-key-001'),
    'igloue',
    'RPC reservation ownership is IGLOUE'
);

create temporary table batch7_retry_result as
select * from public.create_reservation_transaction(
    'Batch7', 'RPC', 'batch7-rpc@example.com', '0600000007', 'essential',
    '2027-02-10 12:00:00+00', '2027-02-13 12:00:00+00', '7 Rue Batch7', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-02-10',
    '0830-1030', '2027-02-13', '1630-1830', 'batch7-rpc-key-001',
    '2027-02-10 06:30:00', '2027-02-13 22:30:00'
);

select is((select reservation_id from batch7_retry_result), (select reservation_id from batch7_rpc_result), 'valid idempotent retry succeeds');

select is((select customer_id from batch7_retry_result), (select customer_id from batch7_rpc_result), 'valid retry uses the same customer');

update public.reservations set organisation_id = null where idempotency_key = 'batch7-rpc-key-001';

select throws_ok(
    $$ select * from public.create_reservation_transaction(
        'Batch7', 'RPC', 'batch7-rpc@example.com', '0600000007', 'essential',
        '2027-02-10 12:00:00+00', '2027-02-13 12:00:00+00', '7 Rue Batch7', null,
        '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-02-10',
        '0830-1030', '2027-02-13', '1630-1830', 'batch7-rpc-key-001',
        '2027-02-10 06:30:00', '2027-02-13 22:30:00') $$,
    'P0001', null,
    'Batch 6 retry validation still rejects NULL ownership'
);

select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'batch7-rpc-key-001'), 2, 'service jobs remain correct');

select ok(exists (select 1 from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'batch7-rpc-key-001'), 'machine hold remains correct');

select * from finish();

rollback;

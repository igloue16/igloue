begin;

select plan(42);

select ok(
    has_table_privilege('authenticated', 'public.organisations', 'SELECT')
    and has_table_privilege('authenticated', 'public.reservations', 'SELECT')
    and has_table_privilege('authenticated', 'public.customers', 'SELECT')
    and has_table_privilege('authenticated', 'public.reservation_items', 'SELECT')
    and has_table_privilege('authenticated', 'public.products', 'SELECT')
    and has_table_privilege('authenticated', 'public.physical_machines', 'SELECT')
    and has_table_privilege('authenticated', 'public.allocations', 'SELECT')
    and has_table_privilege('authenticated', 'public.service_jobs', 'SELECT')
    and has_table_privilege('authenticated', 'public.organisation_members', 'SELECT'),
    'authenticated has SELECT on the admin read surface'
);

select ok(not exists (
    select 1
    from (values
        ('organisations'), ('organisation_members'), ('reservations'),
        ('customers'), ('reservation_items'), ('products'),
        ('physical_machines'), ('allocations'), ('service_jobs')
    ) as t(table_name)
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(privilege_name)
    where has_table_privilege(r.role_name, format('public.%I', t.table_name), p.privilege_name)
), 'browser roles have no mutation or table-management grants on the read surface');

select ok(not exists (
    select 1
    from (values
        ('organisations'), ('organisation_members'), ('reservations'),
        ('customers'), ('reservation_items'), ('products'),
        ('physical_machines'), ('allocations'), ('service_jobs')
    ) as t(table_name)
    where has_table_privilege('anon', format('public.%I', t.table_name), 'SELECT')
), 'anon has no SELECT grants on the admin read surface');

select ok(not exists (
    select 1 from pg_policy
    where polrelid in (
        'public.organisations'::regclass,
        'public.organisation_members'::regclass,
        'public.reservations'::regclass,
        'public.customers'::regclass,
        'public.reservation_items'::regclass,
        'public.products'::regclass,
        'public.physical_machines'::regclass,
        'public.allocations'::regclass,
        'public.service_jobs'::regclass
    )
      and polcmd <> 'r'
), 'read-surface policies are SELECT-only');

select ok(not exists (
    select 1 from pg_policy
    where polrelid in (
        'public.organisations'::regclass,
        'public.reservations'::regclass,
        'public.customers'::regclass,
        'public.reservation_items'::regclass,
        'public.products'::regclass,
        'public.physical_machines'::regclass,
        'public.allocations'::regclass,
        'public.service_jobs'::regclass
    )
      and not (polroles = array[(select oid from pg_roles where rolname='authenticated')]::oid[])
), 'business read policies apply only to authenticated');

select ok((select prosecdef and provolatile='s' and proconfig @> array['search_path=""']
           from pg_proc where oid='public.has_active_organisation_membership(uuid)'::regprocedure),
          'membership policy helper remains stable, SECURITY DEFINER, and search-path pinned');

select ok(exists (
    select 1 from pg_policy
    where polrelid='public.organisation_members'::regclass
      and polname='organisation_members_select_self'
      and polcmd='r'
) and not exists (
    select 1 from pg_policy
    where polrelid='public.organisation_members'::regclass
      and polname <> 'organisation_members_select_self'
), 'membership visibility remains self-only');

select ok(not has_table_privilege('authenticated', 'public.payment_attempts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_provider_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_exceptions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_exception_history', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_refunds', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_refund_attempts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_refund_history', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_refund_provider_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.reservation_payment_capabilities', 'SELECT')
    and not has_table_privilege('authenticated', 'public.outbox_events', 'SELECT')
    and not exists (
        select 1 from pg_policy
        where polrelid in (
            'public.payment_attempts'::regclass,
            'public.payment_provider_events'::regclass,
            'public.payment_exceptions'::regclass,
            'public.payment_exception_history'::regclass,
            'public.payment_refunds'::regclass,
            'public.payment_refund_attempts'::regclass,
            'public.payment_refund_history'::regclass,
            'public.payment_refund_provider_events'::regclass,
            'public.reservation_payment_capabilities'::regclass,
            'public.outbox_events'::regclass
        )
    ), 'payment ledgers and raw outbox payloads remain inaccessible to browser roles');

select ok(
    exists (select 1 from pg_indexes where indexname='products_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='physical_machines_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='reservation_items_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='allocations_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='service_jobs_reservation_id_idx')
    and exists (select 1 from pg_indexes where indexname='reservations_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='customers_organisation_id_idx')
    and exists (select 1 from pg_indexes where indexname='organisation_members_pkey'),
    'RLS tenant lookups and service-job reservation lookup have supporting indexes');

select ok(has_table_privilege('service_role', 'public.organisations', 'SELECT')
    and has_table_privilege('service_role', 'public.organisation_members', 'SELECT')
    and has_table_privilege('service_role', 'public.reservations', 'SELECT')
    and has_table_privilege('service_role', 'public.customers', 'SELECT')
    and has_table_privilege('service_role', 'public.reservation_items', 'SELECT')
    and has_table_privilege('service_role', 'public.products', 'SELECT')
    and has_table_privilege('service_role', 'public.physical_machines', 'SELECT')
    and has_table_privilege('service_role', 'public.allocations', 'SELECT')
    and has_table_privilege('service_role', 'public.service_jobs', 'SELECT'),
    'service_role read grants are preserved');

insert into public.organisations (id, slug, name)
values ('00000000-0000-4000-8000-00000000a201', 'a12-second-tenant', 'A12 Second Tenant');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
    ('00000000-0000-4000-8000-00000000a202', 'authenticated', 'authenticated', 'a12-active@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-4000-8000-00000000a203', 'authenticated', 'authenticated', 'a12-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-4000-8000-00000000a204', 'authenticated', 'authenticated', 'a12-inactive@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organisation_members (organisation_id, user_id, role, active)
values
    ((select id from public.organisations where slug='igloue'), '00000000-0000-4000-8000-00000000a202', 'admin', true),
    ('00000000-0000-4000-8000-00000000a201', '00000000-0000-4000-8000-00000000a203', 'staff', true),
    ((select id from public.organisations where slug='igloue'), '00000000-0000-4000-8000-00000000a204', 'staff', false);

insert into public.products (id, organisation_id, name, weekly_price, deposit_amount)
values ('a12-product-b', '00000000-0000-4000-8000-00000000a201', 'Tenant B Product', 79, 300);

insert into public.physical_machines (id, product_id, status)
values ('a12-machine-a', 'essential', 'available'), ('a12-machine-b', 'a12-product-b', 'available');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
    ('00000000-0000-4000-8000-00000000a205', (select id from public.organisations where slug='igloue'), 'Tenant', 'A', 'a12-customer-a@example.test'),
    ('00000000-0000-4000-8000-00000000a206', '00000000-0000-4000-8000-00000000a201', 'Tenant', 'B', 'a12-customer-b@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status
)
values
    ('00000000-0000-4000-8000-00000000a207', (select id from public.organisations where slug='igloue'),
     '00000000-0000-4000-8000-00000000a205', 'essential', '2050-01-01 10:00+00', '2050-01-05 10:00+00', 'Address A', '16000', 'Angouleme', 59, 59, 'paid'),
    ('00000000-0000-4000-8000-00000000a208', '00000000-0000-4000-8000-00000000a201',
     '00000000-0000-4000-8000-00000000a206', 'a12-product-b', '2050-02-01 10:00+00', '2050-02-05 10:00+00', 'Address B', '75001', 'Paris', 79, 79, 'processing');

insert into public.reservation_items (organisation_id, reservation_id, product_id, unit_rental_price, line_total)
values
    ((select id from public.organisations where slug='igloue'), '00000000-0000-4000-8000-00000000a207', 'essential', 59, 59),
    ('00000000-0000-4000-8000-00000000a201', '00000000-0000-4000-8000-00000000a208', 'a12-product-b', 79, 79);

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values
    ('00000000-0000-4000-8000-00000000a207', 'a12-machine-a', 'reserved', '2050-01-01 10:00+00', '2050-01-05 10:00+00'),
    ('00000000-0000-4000-8000-00000000a208', 'a12-machine-b', 'reserved', '2050-02-01 10:00+00', '2050-02-05 10:00+00');

insert into public.service_jobs (reservation_id, job_type, scheduled_date, address_line_1, postcode, city)
values
    ('00000000-0000-4000-8000-00000000a207', 'delivery', '2050-01-01', 'Address A', '16000', 'Angouleme'),
    ('00000000-0000-4000-8000-00000000a208', 'delivery', '2050-02-01', 'Address B', '75001', 'Paris');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a202';
set local role authenticated;

select is((select count(*) from public.organisations where slug='igloue'), 1::bigint, 'active org A member reads org A');
select is((select count(*) from public.organisations where id='00000000-0000-4000-8000-00000000a201'), 0::bigint, 'active org A member cannot read org B');
select is((select count(*) from public.reservations where id='00000000-0000-4000-8000-00000000a207'), 1::bigint, 'active member reads own reservation');
select is((select count(*) from public.reservations where id='00000000-0000-4000-8000-00000000a208'), 0::bigint, 'active member cannot read other reservation');
select is((select count(*) from public.customers where id='00000000-0000-4000-8000-00000000a205'), 1::bigint, 'active member reads own customer');
select is((select count(*) from public.customers where id='00000000-0000-4000-8000-00000000a206'), 0::bigint, 'active member cannot read other customer');
select is((select count(*) from public.reservation_items where reservation_id='00000000-0000-4000-8000-00000000a207'), 1::bigint, 'active member reads own reservation item');
select is((select count(*) from public.reservation_items where reservation_id='00000000-0000-4000-8000-00000000a208'), 0::bigint, 'active member cannot read other reservation item');
select is((select count(*) from public.products where id='essential'), 1::bigint, 'active member reads own product');
select is((select count(*) from public.products where id='a12-product-b'), 0::bigint, 'active member cannot read other product');
select is((select count(*) from public.physical_machines where id='a12-machine-a'), 1::bigint, 'active member reads own machine');
select is((select count(*) from public.physical_machines where id='a12-machine-b'), 0::bigint, 'active member cannot read other machine');
select is((select count(*) from public.allocations where reservation_id='00000000-0000-4000-8000-00000000a207'), 1::bigint, 'active member reads own allocation');
select is((select count(*) from public.allocations where reservation_id='00000000-0000-4000-8000-00000000a208'), 0::bigint, 'active member cannot read other allocation');
select is((select count(*) from public.service_jobs where reservation_id='00000000-0000-4000-8000-00000000a207'), 1::bigint, 'active member reads jobs through own reservation');
select is((select count(*) from public.service_jobs where reservation_id='00000000-0000-4000-8000-00000000a208'), 0::bigint, 'active member cannot read jobs through other reservation');
select is((select payment_status from public.reservations where id='00000000-0000-4000-8000-00000000a207'), 'paid', 'reservation payment status is visible within tenant scope');
select is((select count(*) from public.reservations where organisation_id='00000000-0000-4000-8000-00000000a201'), 0::bigint, 'filtering directly by another organisation UUID does not bypass RLS');
select is((select count(*) from public.customers where organisation_id='00000000-0000-4000-8000-00000000a201'), 0::bigint, 'direct other-tenant customer filter remains empty');
reset role;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a204';
set local role authenticated;
select is((select count(*) from public.organisations), 0::bigint, 'inactive member sees no organisations');
select is((select count(*) from public.reservations), 0::bigint, 'inactive member sees no reservations');
select is((select count(*) from public.customers), 0::bigint, 'inactive member sees no customers');
select is((select count(*) from public.reservation_items), 0::bigint, 'inactive member sees no reservation items');
select is((select count(*) from public.products), 0::bigint, 'inactive member sees no products');
select is((select count(*) from public.physical_machines), 0::bigint, 'inactive member sees no machines');
select is((select count(*) from public.allocations), 0::bigint, 'inactive member sees no allocations');
select is((select count(*) from public.service_jobs), 0::bigint, 'inactive member sees no service jobs');
reset role;

set local role anon;
select throws_ok($$select * from public.organisations$$, '42501', null, 'anon cannot read organisations');
select throws_ok($$select * from public.reservations$$, '42501', null, 'anon cannot read reservations');
select throws_ok($$select * from public.customers$$, '42501', null, 'anon cannot read customers');
reset role;

set local role service_role;
select is((select count(*) from public.reservations where id in ('00000000-0000-4000-8000-00000000a207','00000000-0000-4000-8000-00000000a208')), 2::bigint, 'service_role reads both tenant reservations');
select is((select count(*) from public.service_jobs where reservation_id in ('00000000-0000-4000-8000-00000000a207','00000000-0000-4000-8000-00000000a208')), 2::bigint, 'service_role reads jobs across tenants');
reset role;

select * from finish();
rollback;

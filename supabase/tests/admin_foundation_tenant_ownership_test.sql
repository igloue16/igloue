begin;

select plan(43);

select ok(to_regclass('public.organisation_members') is not null,
          'organisation_members table exists');
select ok((select relrowsecurity from pg_class where oid='public.organisation_members'::regclass),
          'organisation_members has RLS enabled');
select ok(exists (
    select 1 from pg_constraint
    where conrelid='public.organisation_members'::regclass
      and contype='p'
      and pg_get_constraintdef(oid)='PRIMARY KEY (user_id, organisation_id)'
), 'membership primary key is user and organisation');
select ok(exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='organisation_members'
      and indexname='organisation_members_organisation_id_idx'
), 'organisation membership lookup and cascade index exists');
select ok(exists (
    select 1 from pg_constraint
    where conrelid='public.organisation_members'::regclass
      and conname='organisation_members_organisation_fkey'
      and confrelid='public.organisations'::regclass
      and confdeltype='c'
), 'membership organisation FK cascades on organisation deletion');
select ok(exists (
    select 1 from pg_constraint
    where conrelid='public.organisation_members'::regclass
      and conname='organisation_members_user_fkey'
      and confrelid='auth.users'::regclass
      and confdeltype='c'
), 'membership auth-user FK cascades on user deletion');
select ok(exists (
    select 1 from pg_constraint
    where conrelid='public.organisation_members'::regclass
      and conname='organisation_members_role_check'
      and pg_get_constraintdef(oid) like '%owner%admin%staff%'
), 'membership role vocabulary is constrained');
select ok(exists (
    select 1 from pg_policy
    where polrelid='public.organisation_members'::regclass
      and polname='organisation_members_select_self'
      and polcmd='r'
), 'membership has only the self-select policy');
select ok(to_regprocedure('public.has_active_organisation_membership(uuid)') is not null,
          'active membership helper exists');
select ok((select prosecdef and provolatile='s' and proconfig @> array['search_path=""']
           from pg_proc where oid='public.has_active_organisation_membership(uuid)'::regprocedure),
          'membership helper is stable, SECURITY DEFINER, and pins search_path');
select ok(has_function_privilege('authenticated', 'public.has_active_organisation_membership(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.has_active_organisation_membership(uuid)', 'EXECUTE')
          and not has_function_privilege('public', 'public.has_active_organisation_membership(uuid)', 'EXECUTE'),
          'only authenticated can execute the membership helper');
select ok(has_table_privilege('authenticated', 'public.organisation_members', 'SELECT')
          and not has_table_privilege('authenticated', 'public.organisation_members', 'INSERT')
          and not has_table_privilege('authenticated', 'public.organisation_members', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.organisation_members', 'DELETE')
          and not has_table_privilege('anon', 'public.organisation_members', 'SELECT'),
          'membership browser grants are read-only and authenticated-only');
select ok(has_table_privilege('service_role', 'public.organisation_members', 'SELECT')
          and has_table_privilege('service_role', 'public.organisation_members', 'INSERT')
          and has_table_privilege('service_role', 'public.organisation_members', 'UPDATE')
          and has_table_privilege('service_role', 'public.organisation_members', 'DELETE'),
          'trusted service-role provisioning privileges are preserved');

select ok((select attnotnull from pg_attribute where attrelid='public.products'::regclass and attname='organisation_id' and not attisdropped)
          and exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_organisation_fkey'),
          'products have required organisation ownership');
select ok(exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_id_organisation_id_key' and contype='u'),
          'products have a composite tenant reference key');
select ok((select attnotnull from pg_attribute where attrelid='public.physical_machines'::regclass and attname='organisation_id' and not attisdropped)
          and exists (select 1 from pg_constraint where conrelid='public.physical_machines'::regclass and conname='physical_machines_organisation_fkey'),
          'physical machines have required organisation ownership');
select ok(exists (select 1 from pg_constraint where conrelid='public.physical_machines'::regclass and conname='physical_machines_product_organisation_fkey'),
          'machine product relationship enforces matching organisation');
select ok((select attnotnull from pg_attribute where attrelid='public.allocations'::regclass and attname='organisation_id' and not attisdropped)
          and exists (select 1 from pg_constraint where conrelid='public.allocations'::regclass and conname='allocations_organisation_fkey'),
          'allocations have required organisation ownership');
select ok(exists (select 1 from pg_constraint where conrelid='public.allocations'::regclass and conname='allocations_reservation_organisation_fkey'),
          'allocation reservation relationship enforces matching organisation');
select ok(exists (select 1 from pg_constraint where conrelid='public.allocations'::regclass and conname='allocations_machine_organisation_fkey'),
          'allocation machine relationship enforces matching organisation');
select ok(exists (select 1 from pg_constraint where conrelid='public.reservations'::regclass and conname='reservations_product_organisation_fkey'),
          'reservation product relationship enforces matching organisation');
select ok(exists (select 1 from pg_constraint where conrelid='public.reservation_items'::regclass and conname='reservation_items_product_organisation_fkey'),
          'reservation-item product relationship enforces matching organisation');
select ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name='service_jobs' and column_name='organisation_id'),
          'service-job ownership remains derived through reservation');
select ok(not exists (
    select 1 from public.products p
    where p.organisation_id is distinct from (select id from public.organisations where slug='igloue')
), 'all legacy products are assigned to the IGLOUE organisation');
select ok(not exists (
    select 1 from public.physical_machines m
    left join public.products p on p.id=m.product_id
    where p.id is null or m.organisation_id is distinct from p.organisation_id
), 'all existing machine ownership follows its product');
select ok(not exists (
    select 1 from public.allocations a
    left join public.reservations r on r.id=a.reservation_id
    left join public.physical_machines m on m.id=a.machine_id
    where r.id is null or m.id is null
       or a.organisation_id is distinct from r.organisation_id
       or a.organisation_id is distinct from m.organisation_id
), 'all existing allocation ownership matches reservation and machine');

insert into public.organisations (id, slug, name)
values ('00000000-0000-4000-8000-00000000a110', 'a11-second-tenant', 'A11 Second Tenant');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
    ('00000000-0000-4000-8000-00000000a111', 'authenticated', 'authenticated', 'a11-user-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-4000-8000-00000000a112', 'authenticated', 'authenticated', 'a11-user-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organisation_members (organisation_id, user_id, role, active)
values
    ((select id from public.organisations where slug='igloue'), '00000000-0000-4000-8000-00000000a111', 'owner', true),
    ('00000000-0000-4000-8000-00000000a110', '00000000-0000-4000-8000-00000000a111', 'staff', false),
    ('00000000-0000-4000-8000-00000000a110', '00000000-0000-4000-8000-00000000a112', 'admin', true);

set local role service_role;
select lives_ok($$
    insert into public.organisation_members (organisation_id, user_id, role)
    values ((select id from public.organisations where slug='igloue'),
            '00000000-0000-4000-8000-00000000a112', 'staff')
$$, 'trusted service-role provisioning can add memberships');
reset role;

select throws_ok($$
    insert into public.organisation_members (organisation_id, user_id, role)
    values ('00000000-0000-4000-8000-00000000a110', '00000000-0000-4000-8000-00000000a111', 'platform_admin')
$$, '23514', null, 'unsupported membership role is rejected');

insert into public.products (id, organisation_id, name, weekly_price, deposit_amount)
values ('a11-product-b', '00000000-0000-4000-8000-00000000a110', 'Tenant B Product', 79, 300);

select throws_ok($$
    insert into public.physical_machines (id, product_id, organisation_id, status)
    values ('a11-wrong-machine', 'a11-product-b', (select id from public.organisations where slug='igloue'), 'available')
$$, '23514', null, 'machine cannot claim a different organisation than its product');

insert into public.physical_machines (id, product_id, status)
values ('a11-machine-b', 'a11-product-b', 'available');
select is((select organisation_id from public.physical_machines where id='a11-machine-b'),
          '00000000-0000-4000-8000-00000000a110'::uuid,
          'machine tenant is derived from its product for trusted legacy inserts');
select throws_ok($$
    update public.physical_machines
    set organisation_id = (select id from public.organisations where slug='igloue')
    where id='a11-machine-b'
$$, '23514', null, 'machine cannot be reassigned across its product tenant');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
    ('00000000-0000-4000-8000-00000000a113', (select id from public.organisations where slug='igloue'), 'A11', 'Customer A', 'a11-customer-a@example.test'),
    ('00000000-0000-4000-8000-00000000a114', '00000000-0000-4000-8000-00000000a110', 'A11', 'Customer B', 'a11-customer-b@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount
)
values (
    '00000000-0000-4000-8000-00000000a115',
    (select id from public.organisations where slug='igloue'),
    '00000000-0000-4000-8000-00000000a113', 'essential',
    '2040-01-01 10:00:00+00', '2040-01-05 10:00:00+00', 'A11 address', '16000', 'Angouleme', 59, 59
);

select throws_ok($$
    insert into public.reservations (
        id, organisation_id, customer_id, product_id, rental_start, rental_end,
        delivery_address_line_1, delivery_postcode, delivery_city,
        weekly_price_at_booking, total_amount
    ) values (
        '00000000-0000-4000-8000-00000000a116', '00000000-0000-4000-8000-00000000a110',
        '00000000-0000-4000-8000-00000000a114', 'essential',
        '2040-01-01 10:00:00+00', '2040-01-05 10:00:00+00', 'A11 address', '16000', 'Angouleme', 59, 59
    )
$$, '23503', null, 'reservation cannot reference another organisation product');

select throws_ok($$
    update public.products
    set organisation_id='00000000-0000-4000-8000-00000000a110'
    where id='essential'
$$, '23503', null, 'referenced product ownership cannot change across organisations');

select throws_ok($$
    insert into public.reservation_items (organisation_id, reservation_id, product_id, unit_rental_price, line_total)
    values ((select id from public.organisations where slug='igloue'), '00000000-0000-4000-8000-00000000a115', 'a11-product-b', 79, 79)
$$, '23503', null, 'reservation item cannot reference another organisation product');

select throws_ok($$
    insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
    values ('00000000-0000-4000-8000-00000000a115', 'a11-machine-b', 'held', '2040-01-01 10:00:00+00', '2040-01-05 10:00:00+00')
$$, '23514', null, 'allocation cannot connect a reservation to another organisation machine');

insert into public.physical_machines (id, product_id, status)
values ('a11-machine-a', 'essential', 'available');

select set_config(
    'test.igloue_organisation_id',
    (select id::text from public.organisations where slug='igloue'),
    true
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a111';
select is((select count(*) from public.organisation_members), 2::bigint,
          'authenticated user can read their own memberships and no other users');
select ok(public.has_active_organisation_membership(current_setting('test.igloue_organisation_id')::uuid),
          'active membership returns true');
select ok(not public.has_active_organisation_membership('00000000-0000-4000-8000-00000000a110'),
          'inactive membership returns false');
reset role;

set local role anon;
select throws_ok($$select * from public.organisation_members$$, '42501', null,
                 'anonymous users cannot read membership rows');
select throws_ok($$select public.has_active_organisation_membership('00000000-0000-4000-8000-00000000a110')$$, '42501', null,
                 'anonymous users cannot execute the membership helper');
reset role;

select ok(has_table_privilege('service_role', 'public.reservations', 'SELECT')
          and has_table_privilege('service_role', 'public.reservations', 'INSERT')
          and has_table_privilege('service_role', 'public.products', 'SELECT')
          and has_table_privilege('service_role', 'public.physical_machines', 'SELECT')
          and has_table_privilege('service_role', 'public.allocations', 'INSERT')
          and has_function_privilege('service_role', 'public.create_machine_hold(uuid,timestamptz,timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)', 'EXECUTE'),
          'service-role reservation and allocation workflows retain required access');

-- Exercise an existing trusted writer shape: organisation_id omitted. The
-- trigger derives it, while the composite keys retain tenant integrity.
set local role service_role;
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-4000-8000-00000000a115', 'a11-machine-a', 'held', '2040-01-01 10:00:00+00', '2040-01-05 10:00:00+00');
reset role;
select is((select organisation_id from public.allocations where reservation_id='00000000-0000-4000-8000-00000000a115'),
          (select organisation_id from public.reservations where id='00000000-0000-4000-8000-00000000a115'),
          'trusted allocation inserts derive tenant ownership');
select throws_ok($$
    update public.allocations
    set machine_id='a11-machine-b'
    where reservation_id='00000000-0000-4000-8000-00000000a115'
$$, '23514', null, 'allocation cannot be moved to another organisation machine');

select * from finish();
rollback;

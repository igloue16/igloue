begin;

select plan(17);

select ok(
    exists (
        select 1
        from pg_attribute
        where attrelid = 'public.reservations'::regclass
          and attname = 'deposit_amount'
          and not attnotnull
    ),
    'reservation deposit snapshot accepts NULL'
);
select ok(
    exists (
        select 1
        from pg_attribute
        where attrelid = 'public.reservations'::regclass
          and attname = 'deposit_amount'
          and atttypid = 'numeric'::regtype
          and atttypmod = 655366
    ),
    'reservation deposit snapshot remains numeric(10,2)'
);
select ok(
    exists (
        select 1
        from pg_attribute
        where attrelid = 'public.products'::regclass
          and attname = 'deposit_amount'
          and attnotnull
    ),
    'product deposit remains NOT NULL'
);
select is(
    (select column_default::text from information_schema.columns
     where table_schema = 'public' and table_name = 'products' and column_name = 'deposit_amount'),
    '0'::text,
    'product deposit default remains zero'
);

insert into public.organisations (id, slug, name)
values ('00000000-0000-0000-0000-00000000c0a1', 'mm3c0a-org', 'MM3C0A Organisation');
insert into public.products (id, name, weekly_price, deposit_amount)
values ('mm3c0a-product', 'MM3C0A Product', 59.00, 250.00);
insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0a1',
        'MM3C0A', 'Customer', 'mm3c0a@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, deposit_amount, total_amount
) values
    ('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0a1',
     '00000000-0000-0000-0000-00000000c0a2', 'mm3c0a-product', now() + interval '40 days',
     now() + interval '47 days', '1 MM3C0A Street', '16000', 'Angouleme', 59.00, NULL, 59.00),
    ('00000000-0000-0000-0000-00000000c0a4', '00000000-0000-0000-0000-00000000c0a1',
     '00000000-0000-0000-0000-00000000c0a2', 'mm3c0a-product', now() + interval '50 days',
     now() + interval '57 days', '2 MM3C0A Street', '16000', 'Angouleme', 59.00, 0, 59.00),
    ('00000000-0000-0000-0000-00000000c0a5', '00000000-0000-0000-0000-00000000c0a1',
     '00000000-0000-0000-0000-00000000c0a2', 'mm3c0a-product', now() + interval '60 days',
     now() + interval '67 days', '3 MM3C0A Street', '16000', 'Angouleme', 59.00, 250.00, 59.00);

select is((select deposit_amount from public.reservations where id = '00000000-0000-0000-0000-00000000c0a3'), null::numeric, 'NULL means no traditional deposit');
select is((select total_amount from public.reservations where id = '00000000-0000-0000-0000-00000000c0a3'), 59.00::numeric, 'NULL deposit leaves reservation total unchanged');
select is((select deposit_amount from public.reservations where id = '00000000-0000-0000-0000-00000000c0a4'), 0.00::numeric, 'zero deposit remains valid');
select is((select deposit_amount from public.reservations where id = '00000000-0000-0000-0000-00000000c0a5'), 250.00::numeric, 'numeric deposit remains valid');
select is((select count(*)::integer from public.reservations where id in ('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0a4', '00000000-0000-0000-0000-00000000c0a5')), 3, 'existing rows are not backfilled');

select is(null::numeric is not distinct from null::numeric, true, 'NULL matches NULL with null-safe semantics');
select is(200.00::numeric is not distinct from 200.00::numeric, true, 'equal numeric deposits match');
select is(null::numeric is distinct from 200.00::numeric, true, 'NULL differs from numeric deposit');
select is(200.00::numeric is distinct from null::numeric, true, 'numeric deposit differs from NULL');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('MM3C0A-NULL-MACHINE', 'essential', 'MM3C0A-NULL-SERIAL', 'available', true);

create temporary table mm3c0a_null_first as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3C0A', 'No Deposit', 'mm3c0a-null@example.test', '0612345678',
    'essential', '2041-01-01 12:00:00+00', '2041-01-08 12:00:00+00',
    '1 MM3C0A Street', null, '16000', 'Angouleme', 'local',
    59, 29, 0, NULL, 88,
    '2041-01-01', '0830-1030', '2041-01-08', '1630-1830',
    'mm3c0a-null-creation-1', '2041-01-01 06:30:00', '2041-01-08 22:30:00',
    'MM3C0A', 'No Deposit', '0612345678',
    'personal', 'MM3C0A No Deposit', NULL, 'mm3c0a-null@example.test',
    '1 MM3C0A Street', NULL, '16000', 'Angouleme', 'FR',
    59, 59
);

select is((select created_new from mm3c0a_null_first), true, 'normalized creation accepts NULL deposit');
select is((select deposit_amount from public.reservations where id = (select reservation_id from mm3c0a_null_first)), null::numeric, 'normalized NULL deposit is snapshotted as NULL');
select is((select total_amount from public.reservations where id = (select reservation_id from mm3c0a_null_first)), 88.00::numeric, 'NULL deposit does not alter reservation total');

create temporary table mm3c0a_null_replay as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3C0A', 'No Deposit', 'mm3c0a-null@example.test', '0612345678',
    'essential', '2041-01-01 12:00:00+00', '2041-01-08 12:00:00+00',
    '1 MM3C0A Street', null, '16000', 'Angouleme', 'local',
    59, 29, 0, NULL, 88,
    '2041-01-01', '0830-1030', '2041-01-08', '1630-1830',
    'mm3c0a-null-creation-1', '2041-01-01 06:30:00', '2041-01-08 22:30:00',
    'MM3C0A', 'No Deposit', '0612345678',
    'personal', 'MM3C0A No Deposit', NULL, 'mm3c0a-null@example.test',
    '1 MM3C0A Street', NULL, '16000', 'Angouleme', 'FR',
    59, 59
);

select is((select created_new from mm3c0a_null_replay), false, 'NULL vs NULL replay matches');

select * from finish();
rollback;

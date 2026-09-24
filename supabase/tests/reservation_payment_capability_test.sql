begin;

select plan(16);

select ok(to_regclass('public.reservation_payment_capabilities') is not null, 'payment capability table exists');
select ok(
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservation_payment_capabilities' and column_name = 'capability_hash' and is_nullable = 'NO')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservation_payment_capabilities' and column_name = 'expires_at' and is_nullable = 'NO')
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservation_payment_capabilities' and column_name in ('raw_capability', 'capability_token')),
    'capability stores only a required hash and expiry, never raw material'
);
select ok((select relrowsecurity from pg_class where oid = 'public.reservation_payment_capabilities'::regclass), 'capability RLS is enabled');
select ok(
    has_table_privilege('service_role', 'public.reservation_payment_capabilities', 'SELECT')
    and has_table_privilege('service_role', 'public.reservation_payment_capabilities', 'INSERT')
    and has_table_privilege('service_role', 'public.reservation_payment_capabilities', 'UPDATE')
    and not has_table_privilege('service_role', 'public.reservation_payment_capabilities', 'DELETE'),
    'service_role has minimum capability table privileges'
);
select ok(
    not has_table_privilege('public', 'public.reservation_payment_capabilities', 'SELECT')
    and not has_table_privilege('anon', 'public.reservation_payment_capabilities', 'SELECT')
    and not has_table_privilege('authenticated', 'public.reservation_payment_capabilities', 'SELECT'),
    'browser roles cannot read capabilities'
);
select ok(
    has_function_privilege('service_role', 'public.create_reservation_with_payment_capability(text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,date,text,date,text,text,timestamp without time zone,timestamp without time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_reservation_with_payment_capability(text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,date,text,date,text,text,timestamp without time zone,timestamp without time zone)', 'EXECUTE'),
    'capability wrapper is service_role-only'
);

insert into public.organisations (id, slug, name)
values ('00000000-0000-4000-8000-00000000b001', 'payment-capability-test', 'Payment Capability Test');
insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000b002', (select id from public.organisations where slug = 'igloue'), 'Capability', 'Fixture', 'capability@example.test');
insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
) values (
    '00000000-0000-4000-8000-00000000b003',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000b002', 'essential',
    now() + interval '10 days', now() + interval '17 days',
    '1 Capability Street', '16000', 'Angouleme', 59, 88, 'not_started',
    'capability-fixture-reservation'
);
insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
) values (
    '00000000-0000-4000-8000-00000000b004',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000b002', 'essential',
    now() + interval '20 days', now() + interval '27 days',
    '2 Capability Street', '16000', 'Angouleme', 59, 88, 'not_started',
    'capability-fixture-reservation-2'
);

insert into public.reservation_payment_capabilities (
    organisation_id, reservation_id, capability_hash, expires_at
) values (
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000b003',
    chr(92) || 'x' || repeat('a', 64),
    now() + interval '30 minutes'
);
select ok(true, 'valid hashed capability inserts');
select throws_ok($$insert into public.reservation_payment_capabilities (organisation_id, reservation_id, capability_hash, expires_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000b003', chr(92) || 'x' || repeat('a', 64), now() + interval '30 minutes')$$, '23505', null, 'one capability per reservation is enforced');
select throws_ok($$insert into public.reservation_payment_capabilities (organisation_id, reservation_id, capability_hash, expires_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000b003', '', now() + interval '30 minutes')$$, '23514', null, 'blank capability hash is rejected');
select throws_ok($$insert into public.reservation_payment_capabilities (organisation_id, reservation_id, capability_hash, expires_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000b003', chr(92) || 'x' || repeat('b', 64), now() - interval '1 minute')$$, '23514', null, 'capability expiry must be future relative to creation');
select throws_ok($$insert into public.reservation_payment_capabilities (organisation_id, reservation_id, capability_hash, expires_at) values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b004', chr(92) || 'x' || repeat('c', 64), now() + interval '30 minutes')$$, '23503', null, 'reservation organisation ownership is enforced');
select throws_ok($$insert into public.reservation_payment_capabilities (organisation_id, reservation_id, capability_hash, expires_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000b999', chr(92) || 'x' || repeat('d', 64), now() + interval '30 minutes')$$, '23503', null, 'reservation foreign key is enforced');

update public.reservation_payment_capabilities
set used_at = now()
where reservation_id = '00000000-0000-4000-8000-00000000b003';
select ok((select used_at is not null and revoked_at is null from public.reservation_payment_capabilities where reservation_id = '00000000-0000-4000-8000-00000000b003'), 'used capability remains lifecycle-consistent');
update public.reservation_payment_capabilities
set used_at = null, revoked_at = now()
where reservation_id = '00000000-0000-4000-8000-00000000b003';
select ok((select used_at is null and revoked_at is not null from public.reservation_payment_capabilities where reservation_id = '00000000-0000-4000-8000-00000000b003'), 'revoked capability remains lifecycle-consistent');
select throws_ok($$update public.reservation_payment_capabilities set used_at = now(), revoked_at = now() where reservation_id = '00000000-0000-4000-8000-00000000b003'$$, '23514', null, 'used and revoked cannot both be set');

select is((select count(*)::integer from public.reservations where id = '00000000-0000-4000-8000-00000000b003'), 1, 'capability foundation does not alter reservation rows');
select * from finish();
rollback;

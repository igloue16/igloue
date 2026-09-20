begin;

select plan(21);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'email_verification_status'
          and data_type = 'text'
          and is_nullable = 'NO'
          and column_default like '%pending%'
    ),
    'reservation email verification status is a required text column defaulting to pending'
);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'email_verified_at'
          and data_type = 'timestamp with time zone'
          and is_nullable = 'YES'
    ),
    'reservation email verified timestamp exists and is nullable'
);

select throws_ok(
    $$
        insert into public.reservations (
            id, organisation_id, customer_id, product_id, rental_start, rental_end,
            email_verification_status, email_verified_at,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000003301',
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003302', 'essential',
            '2027-01-01 10:00:00+00', '2027-01-04 10:00:00+00',
            'invalid', null, '3D3B', '16000', 'Angouleme', 59, 250, 309
        )
    $$,
    '23514', null,
    'invalid verification status is rejected'
);

select throws_ok(
    $$
        insert into public.reservations (
            id, organisation_id, customer_id, product_id, rental_start, rental_end,
            email_verification_status, email_verified_at,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000003303',
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003302', 'essential',
            '2027-01-01 10:00:00+00', '2027-01-04 10:00:00+00',
            'verified', null, '3D3B', '16000', 'Angouleme', 59, 250, 309
        )
    $$,
    '23514', null,
    'verified status requires a verification timestamp'
);

select throws_ok(
    $$
        insert into public.reservations (
            id, organisation_id, customer_id, product_id, rental_start, rental_end,
            email_verification_status, email_verified_at,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000003304',
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003302', 'essential',
            '2027-01-01 10:00:00+00', '2027-01-04 10:00:00+00',
            'pending', now(), '3D3B', '16000', 'Angouleme', 59, 250, 309
        )
    $$,
    '23514', null,
    'pending status rejects a verification timestamp'
);

select ok(
    to_regclass('public.reservation_security_tokens') is not null,
    'reservation security token table exists'
);

select ok(
    not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservation_security_tokens'
          and column_name in ('plaintext_token', 'raw_token', 'verification_url')
    ),
    'token table has no plaintext or usable-token columns'
);

select ok(
    exists (select 1 from pg_constraint where conname = 'reservation_security_tokens_purpose_check')
    and exists (select 1 from pg_constraint where conname = 'reservation_security_tokens_organisation_fkey')
    and exists (select 1 from pg_constraint where conname = 'reservation_security_tokens_reservation_customer_fkey'),
    'token purpose and ownership constraints exist'
);

select ok(
    exists (select 1 from pg_indexes where indexname = 'reservation_security_tokens_hash_purpose_idx')
    and exists (select 1 from pg_indexes where indexname = 'reservation_security_tokens_reservation_purpose_idx')
    and exists (select 1 from pg_indexes where indexname = 'reservation_security_tokens_expiry_idx')
    and exists (select 1 from pg_indexes where indexname = 'reservation_security_tokens_one_active_email_idx'),
    'token lookup, expiry and active-token indexes exist'
);

insert into public.customers (id, organisation_id, first_name, last_name, email, phone)
values (
    '00000000-0000-0000-0000-000000003302',
    (select id from public.organisations where slug = 'igloue'),
    'Schema', 'Token', 'schema-token-3302@example.com', '0600003302'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, deposit_amount, total_amount
) values (
    '00000000-0000-0000-0000-000000003301',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000003302', 'essential',
    '2027-01-01 10:00:00+00', '2027-01-04 10:00:00+00',
    '3D3B', '16000', 'Angouleme', 59, 250, 309
);

select lives_ok(
    $$
        insert into public.reservation_security_tokens (
            organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003302',
            'email_verification', decode(repeat('ab', 32), 'hex'),
            now() + interval '30 minutes'
        )
    $$,
    'trusted test context can insert a valid token row'
);

-- Retire the valid fixture before deliberately inserting ownership-invalid
-- rows, so the one-active-token index does not mask their FK violations.
update public.reservation_security_tokens
set consumed_at = now()
where token_hash = decode(repeat('ab', 32), 'hex');

select throws_ok(
    $$
        insert into public.reservation_security_tokens (
            organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003302',
            'reservation_access', decode(repeat('ac', 32), 'hex'),
            now() + interval '30 minutes'
        )
    $$,
    '23514', null,
    'unsupported token purpose is rejected'
);

select throws_ok(
    $$
        insert into public.reservation_security_tokens (
            organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003302',
            'email_verification', decode(repeat('ad', 32), 'hex'),
            now()
        )
    $$,
    '23514', null,
    'token expiry must be after creation'
);

select throws_ok(
    $$
        insert into public.reservation_security_tokens (
            id, organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at, superseded_by
        ) values (
            '00000000-0000-0000-0000-000000003305',
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003302',
            'email_verification', decode(repeat('ae', 32), 'hex'),
            now() + interval '30 minutes',
            '00000000-0000-0000-0000-000000003305'
        )
    $$,
    '23514', null,
    'token cannot supersede itself'
);

insert into public.organisations (slug, name)
values ('batch3b-other', 'Batch 3B Other');
insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-0000-0000-000000003306',
    (select id from public.organisations where slug = 'batch3b-other'),
    'Other', 'Tenant', 'schema-token-3306@example.com'
);

select throws_ok(
    $$
        insert into public.reservation_security_tokens (
            organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003306',
            'email_verification', decode(repeat('af', 32), 'hex'),
            now() + interval '30 minutes'
        )
    $$,
    '23503', null,
    'wrong-customer token relationship is rejected'
);

select throws_ok(
    $$
        insert into public.reservation_security_tokens (
            organisation_id, reservation_id, customer_id, purpose,
            token_hash, expires_at
        ) values (
            (select id from public.organisations where slug = 'batch3b-other'),
            '00000000-0000-0000-0000-000000003301',
            '00000000-0000-0000-0000-000000003302',
            'email_verification', decode(repeat('b0', 32), 'hex'),
            now() + interval '30 minutes'
        )
    $$,
    '23503', null,
    'cross-organisation token relationship is rejected'
);

select ok(
    (select relrowsecurity from pg_class where oid = 'public.reservation_security_tokens'::regclass),
    'token table has RLS enabled'
);

select ok(
    not has_table_privilege('anon', 'public.reservation_security_tokens', 'SELECT')
    and not has_table_privilege('anon', 'public.reservation_security_tokens', 'INSERT')
    and not has_table_privilege('anon', 'public.reservation_security_tokens', 'UPDATE')
    and not has_table_privilege('anon', 'public.reservation_security_tokens', 'DELETE'),
    'anon has no token table privileges'
);

select ok(
    not has_table_privilege('authenticated', 'public.reservation_security_tokens', 'SELECT')
    and not has_table_privilege('authenticated', 'public.reservation_security_tokens', 'INSERT')
    and not has_table_privilege('authenticated', 'public.reservation_security_tokens', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.reservation_security_tokens', 'DELETE'),
    'authenticated has no token table privileges'
);

select ok(
    has_table_privilege('service_role', 'public.reservation_security_tokens', 'SELECT')
    and has_table_privilege('service_role', 'public.reservation_security_tokens', 'INSERT')
    and has_table_privilege('service_role', 'public.reservation_security_tokens', 'UPDATE')
    and has_table_privilege('service_role', 'public.reservation_security_tokens', 'DELETE'),
    'service_role retains backend token table privileges'
);

select is(
    (select email_verification_status from public.reservations where id = '00000000-0000-0000-0000-000000003301'),
    'pending',
    'new reservation defaults email verification to pending'
);

select is(
    (select email_verified_at from public.reservations where id = '00000000-0000-0000-0000-000000003301'),
    null::timestamptz,
    'new reservation starts without a verification timestamp'
);

select * from finish();

rollback;

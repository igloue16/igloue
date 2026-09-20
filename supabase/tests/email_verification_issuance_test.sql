begin;

select plan(24);

select ok(
    has_function_privilege('service_role', 'public.issue_email_verification_token(uuid,bytea,timestamp with time zone)', 'EXECUTE'),
    'service_role can issue email verification tokens'
);
select ok(
    not has_function_privilege('public', 'public.issue_email_verification_token(uuid,bytea,timestamp with time zone)', 'EXECUTE'),
    'PUBLIC cannot issue email verification tokens'
);
select ok(
    not has_function_privilege('anon', 'public.issue_email_verification_token(uuid,bytea,timestamp with time zone)', 'EXECUTE'),
    'anon cannot issue email verification tokens'
);
select ok(
    not has_function_privilege('authenticated', 'public.issue_email_verification_token(uuid,bytea,timestamp with time zone)', 'EXECUTE'),
    'authenticated cannot issue email verification tokens'
);

insert into public.products (id, name, weekly_price, deposit_amount)
values ('essential', 'Essential', 59, 250)
on conflict (id) do nothing;

insert into public.customers (id, organisation_id, first_name, last_name, email, phone)
values (
    '00000000-0000-4000-8000-000000000302',
    (select id from public.organisations where slug = 'igloue'),
    'Issue', 'Token', 'issue-token-3302@example.com', '0600003302'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, deposit_amount, total_amount, payment_status
) values (
    '00000000-0000-4000-8000-000000000301',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-000000000302', 'essential',
    now() + interval '1 hour', now() + interval '4 days',
    '3D3C', '16000', 'Angouleme', 59, 250, 309, 'not_started'
);

insert into public.physical_machines (
    id, product_id, serial_number, status, active
) values (
    'TEST-3D3C-E01', 'essential', 'TEST-3D3C-SERIAL-01', 'available', true
);

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start,
    operational_end, hold_expires_at
) values (
    '00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000301',
    'TEST-3D3C-E01', 'held', now() + interval '1 hour',
    now() + interval '4 days', now() + interval '20 minutes'
);

create temporary table original_hold as
select hold_expires_at
from public.allocations
where id = '00000000-0000-4000-8000-000000000303';

create temporary table issuance_one as
select * from public.issue_email_verification_token(
    '00000000-0000-4000-8000-000000000301',
    decode(repeat('11', 32), 'hex'),
    now() + interval '30 minutes'
);

select is((select count(*)::integer from issuance_one), 1, 'eligible pending reservation issues one token');
select is((select organisation_id from issuance_one), (select organisation_id from public.reservations where id = '00000000-0000-4000-8000-000000000301'), 'issued token keeps reservation organisation');
select is((select customer_id from issuance_one), '00000000-0000-4000-8000-000000000302'::uuid, 'issued token keeps reservation customer');
select ok((select expires_at <= (select hold_expires_at from public.allocations where id = '00000000-0000-4000-8000-000000000303') from issuance_one), 'token expiry does not outlive the machine hold');
select is((select purpose from public.reservation_security_tokens where token_hash = decode(repeat('11', 32), 'hex')), 'email_verification', 'issued token purpose is fixed');
select is((select octet_length(token_hash) from public.reservation_security_tokens where token_hash = decode(repeat('11', 32), 'hex')), 32, 'stored token representation is a 32-byte hash');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-000000000301'), 'pending', 'issuance does not confirm the reservation');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-000000000301'), 'not_started', 'issuance does not change payment status');
select is((select hold_expires_at from public.allocations where id = '00000000-0000-4000-8000-000000000303'), (select hold_expires_at from original_hold), 'issuance does not extend the machine hold');
select is((select count(*)::integer from public.reservations where id = '00000000-0000-4000-8000-000000000301'), 1, 'issuance creates no reservation');
select is((select count(*)::integer from public.customers where id = '00000000-0000-4000-8000-000000000302'), 1, 'issuance creates no customer');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-000000000301'), 1, 'issuance creates no allocation');

select throws_ok(
    $$select * from public.issue_email_verification_token(
        '00000000-0000-4000-8000-000000000301', decode(repeat('22', 32), 'hex'), now() + interval '30 minutes'
    )$$,
    'P0004', null,
    'rapid resend is blocked by the cooldown'
);

update public.reservation_security_tokens
set created_at = now() - interval '61 seconds'
where token_hash = decode(repeat('11', 32), 'hex');

create temporary table issuance_two as
select * from public.issue_email_verification_token(
    '00000000-0000-4000-8000-000000000301',
    decode(repeat('33', 32), 'hex'),
    now() + interval '30 minutes'
);

select is((select count(*)::integer from public.reservation_security_tokens where reservation_id = '00000000-0000-4000-8000-000000000301'), 2, 'resend keeps one reservation and records a replacement token');
select is((select revoked_at is not null from public.reservation_security_tokens where token_hash = decode(repeat('11', 32), 'hex')), true, 'resend revokes the previous token');
select is((select superseded_by from public.reservation_security_tokens where token_hash = decode(repeat('11', 32), 'hex')), (select token_id from issuance_two), 'resend links the old token to its successor');
select is((select count(*)::integer from public.reservation_security_tokens where reservation_id = '00000000-0000-4000-8000-000000000301' and consumed_at is null and revoked_at is null and superseded_by is null), 1, 'resend leaves exactly one active token');

update public.reservations
set status = 'confirmed'
where id = '00000000-0000-4000-8000-000000000301';
select throws_ok(
    $$select * from public.issue_email_verification_token(
        '00000000-0000-4000-8000-000000000301', decode(repeat('35', 32), 'hex'), now() + interval '30 minutes'
    )$$,
    'P0001', null,
    'confirmed reservation cannot issue a token'
);

update public.reservations
set status = 'pending', email_verification_status = 'verified', email_verified_at = now()
where id = '00000000-0000-4000-8000-000000000301';
select throws_ok(
    $$select * from public.issue_email_verification_token(
        '00000000-0000-4000-8000-000000000301', decode(repeat('36', 32), 'hex'), now() + interval '30 minutes'
    )$$,
    'P0001', null,
    'verified reservation cannot issue a token'
);

update public.reservations
set email_verification_status = 'pending', email_verified_at = null
where id = '00000000-0000-4000-8000-000000000301';

update public.allocations set hold_expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000303';
select throws_ok(
    $$select * from public.issue_email_verification_token(
        '00000000-0000-4000-8000-000000000301', decode(repeat('44', 32), 'hex'), now() + interval '30 minutes'
    )$$,
    'P0001', null,
    'expired hold cannot issue a token'
);

select * from finish();

rollback;

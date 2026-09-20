begin;

select plan(32);

select ok(has_function_privilege('service_role', 'public.consume_email_verification_token(bytea)', 'EXECUTE'), 'backend can consume verification tokens');
select ok(not has_function_privilege('public', 'public.consume_email_verification_token(bytea)', 'EXECUTE'), 'PUBLIC cannot consume tokens');
select ok(not has_function_privilege('anon', 'public.consume_email_verification_token(bytea)', 'EXECUTE'), 'anon cannot consume tokens');
select ok(not has_function_privilege('authenticated', 'public.consume_email_verification_token(bytea)', 'EXECUTE'), 'authenticated cannot consume tokens');

insert into public.products (id, name, weekly_price, deposit_amount)
values ('essential', 'Essential', 59, 250) on conflict (id) do nothing;
insert into public.customers (id, organisation_id, first_name, last_name, email, phone)
values ('00000000-0000-4000-8000-000000000400',
        (select id from public.organisations where slug = 'igloue'),
        'Consume', 'Test', 'consume-3d3d@example.com', '0600000400');

insert into public.physical_machines (id, product_id, serial_number, status, active)
select 'TEST-3D3D-' || n, 'essential', 'SERIAL-3D3D-' || n, 'available', true
from generate_series(401, 408) as n;

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, deposit_amount, total_amount, payment_status
)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (select id from public.organisations where slug = 'igloue'),
       '00000000-0000-4000-8000-000000000400'::uuid, 'essential',
       now() + interval '1 day', now() + interval '4 days',
       '3D3D', '16000', 'Angouleme', 59, 250, 309, 'not_started'
from generate_series(401, 408) as n;

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start, operational_end,
    hold_expires_at
)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'TEST-3D3D-' || n, 'held', now() + interval '1 day',
       now() + interval '4 days', now() + interval '20 minutes'
from generate_series(401, 408) as n;

insert into public.reservation_security_tokens (
    id, organisation_id, reservation_id, customer_id, purpose, token_hash, expires_at
)
select ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (select id from public.organisations where slug = 'igloue'),
       ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-4000-8000-000000000400'::uuid,
       'email_verification', decode(lpad(to_hex(n), 64, '0'), 'hex'),
       now() + interval '15 minutes'
from generate_series(401, 408) as n;

create temporary table before_consume as
select r.id, r.customer_id, r.total_amount, r.payment_status, r.status,
       a.id as allocation_id, a.machine_id, a.hold_expires_at
from public.reservations r join public.allocations a on a.reservation_id = r.id
where r.id = '00000000-0000-4000-8000-000000000401';

select is(public.consume_email_verification_token(decode(lpad(to_hex(401),64,'0'),'hex')), true, 'live credential verifies a pending reservation');
select is((select email_verification_status from public.reservations where id = '00000000-0000-4000-8000-000000000401'), 'verified', 'verification state becomes verified');
select ok((select email_verified_at is not null from public.reservations where id = '00000000-0000-4000-8000-000000000401'), 'email_verified_at is set');
select ok((select consumed_at is not null from public.reservation_security_tokens where reservation_id = '00000000-0000-4000-8000-000000000401'), 'credential is consumed');
select is((select email_verified_at from public.reservations where id = '00000000-0000-4000-8000-000000000401'),
          (select consumed_at from public.reservation_security_tokens where reservation_id = '00000000-0000-4000-8000-000000000401'), 'transition and consumption use the same timestamp');
select is((select a.hold_expires_at from public.allocations a where a.reservation_id = '00000000-0000-4000-8000-000000000401'),
          (select hold_expires_at from before_consume), 'hold deadline is unchanged');
select is((select r.payment_status from public.reservations r where r.id = '00000000-0000-4000-8000-000000000401'),
          (select payment_status from before_consume), 'payment status is unchanged');
select is((select r.status from public.reservations r where r.id = '00000000-0000-4000-8000-000000000401'),
          (select status from before_consume), 'verification does not confirm reservation');
select is((select a.id from public.allocations a where a.reservation_id = '00000000-0000-4000-8000-000000000401'),
          (select allocation_id from before_consume), 'allocation identity is unchanged');
select is((select a.machine_id from public.allocations a where a.reservation_id = '00000000-0000-4000-8000-000000000401'),
          (select machine_id from before_consume), 'allocated machine is unchanged');
select is((select r.customer_id from public.reservations r where r.id = '00000000-0000-4000-8000-000000000401'),
          (select customer_id from before_consume), 'customer is unchanged');
select is((select r.total_amount from public.reservations r where r.id = '00000000-0000-4000-8000-000000000401'),
          (select total_amount from before_consume), 'pricing is unchanged');

select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(401),64,'0'),'hex'))$$,
    'P0001', null, 'replay returns generic failure');
select is((select count(*)::integer from public.reservation_security_tokens where reservation_id = '00000000-0000-4000-8000-000000000401' and consumed_at is not null), 1, 'replay creates no second consumption');

update public.reservation_security_tokens
set created_at = now() - interval '1 hour',
    expires_at = now() - interval '1 second'
where reservation_id = '00000000-0000-4000-8000-000000000402';
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(402),64,'0'),'hex'))$$,
    'P0001', null, 'expired credential fails');

update public.allocations set hold_expires_at = now() - interval '1 second'
where reservation_id = '00000000-0000-4000-8000-000000000403';
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(403),64,'0'),'hex'))$$,
    'P0001', null, 'expired hold independently blocks a live credential');

update public.reservation_security_tokens set revoked_at = now()
where reservation_id = '00000000-0000-4000-8000-000000000404';
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(404),64,'0'),'hex'))$$,
    'P0001', null, 'revoked credential fails');

update public.reservation_security_tokens set revoked_at = now()
where reservation_id = '00000000-0000-4000-8000-000000000405';
insert into public.reservation_security_tokens (
    id, organisation_id, reservation_id, customer_id, purpose, token_hash, expires_at
)
select '20000000-0000-4000-8000-000000000455', organisation_id,
       reservation_id, customer_id, purpose, decode(lpad(to_hex(455),64,'0'),'hex'),
       now() + interval '15 minutes'
from public.reservation_security_tokens
where reservation_id = '00000000-0000-4000-8000-000000000405';
update public.reservation_security_tokens
set superseded_by = '20000000-0000-4000-8000-000000000455'
where reservation_id = '00000000-0000-4000-8000-000000000405'
  and token_hash = decode(lpad(to_hex(405),64,'0'),'hex');
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(405),64,'0'),'hex'))$$,
    'P0001', null, 'superseded credential cannot verify');
select is(public.consume_email_verification_token(decode(lpad(to_hex(455),64,'0'),'hex')), true, 'only replacement credential verifies');

select throws_ok($$select public.consume_email_verification_token(decode(repeat('ef',32),'hex'))$$,
    'P0001', null, 'unknown digest fails generically');

select throws_ok($$insert into public.reservation_security_tokens (
    organisation_id, reservation_id, customer_id, purpose, token_hash, expires_at
) select organisation_id, reservation_id, customer_id, 'reservation_access',
         decode(repeat('fa',32),'hex'), now() + interval '10 minutes'
    from public.reservation_security_tokens
    where reservation_id = '00000000-0000-4000-8000-000000000406'$$,
    '23514', null, 'wrong-purpose credential is rejected by schema');

-- Isolate the future-purpose test inside a savepoint; restore the production
-- CHECK and fixture immediately afterward. No committed constraint changes.
savepoint purpose_probe;
alter table public.reservation_security_tokens
    drop constraint reservation_security_tokens_purpose_check;
update public.reservation_security_tokens set revoked_at = now()
where reservation_id = '00000000-0000-4000-8000-000000000406';
insert into public.reservation_security_tokens (
    organisation_id, reservation_id, customer_id, purpose, token_hash, expires_at
)
select organisation_id, reservation_id, customer_id, 'reservation_access',
       decode(repeat('fa',32),'hex'), now() + interval '10 minutes'
from public.reservation_security_tokens
where reservation_id = '00000000-0000-4000-8000-000000000406';
select throws_ok($$select public.consume_email_verification_token(decode(repeat('fa',32),'hex'))$$,
    'P0001', null, 'consume RPC rejects a different token purpose');
rollback to savepoint purpose_probe;

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-000000000499',
        (select id from public.organisations where slug = 'igloue'),
        'Other', 'Customer', 'other-consume-3d3d@example.com');

select throws_ok($$update public.reservation_security_tokens
    set customer_id = '00000000-0000-4000-8000-000000000499'
    where reservation_id = '00000000-0000-4000-8000-000000000406'$$,
    '23503', null, 'composite ownership prevents token/customer mismatch');

update public.allocations set hold_expires_at = now() - interval '1 second'
where reservation_id = '00000000-0000-4000-8000-000000000407';
select lives_ok($$select * from public.expire_reservation_hold('00000000-0000-4000-8000-000000000407')$$,
    'hold cleanup cancels and releases an expired reservation');
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(407),64,'0'),'hex'))$$,
    'P0001', null, 'cleanup-won reservation cannot be resurrected');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-000000000407'), 'cancelled', 'cleanup-won reservation stays cancelled');

update public.reservations set status = 'confirmed'
where id = '00000000-0000-4000-8000-000000000408';
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(408),64,'0'),'hex'))$$,
    'P0001', null, 'confirmed reservation cannot be verified by this operation');

update public.reservations set status = 'pending'
where id = '00000000-0000-4000-8000-000000000408';
update public.allocations set status = 'released', released_at = now(), hold_expires_at = null
where reservation_id = '00000000-0000-4000-8000-000000000408';
select throws_ok($$select public.consume_email_verification_token(decode(lpad(to_hex(408),64,'0'),'hex'))$$,
    'P0001', null, 'missing held allocation cannot verify');

select * from finish();
rollback;

begin;

select plan(46);

select ok(to_regprocedure('public.initiate_reservation_payment(uuid,text,text)') is not null,
          'payment initiation function exists');
select ok(
    pg_get_function_identity_arguments('public.initiate_reservation_payment(uuid,text,text)'::regprocedure)
        = 'p_reservation_id uuid, p_capability_hash text, p_idempotency_key text',
    'payment initiation signature is correct'
);
select ok(has_function_privilege('service_role', 'public.initiate_reservation_payment(uuid,text,text)', 'EXECUTE'), 'service_role can initiate payment');
select ok(not has_function_privilege('public', 'public.initiate_reservation_payment(uuid,text,text)', 'EXECUTE'), 'PUBLIC cannot initiate payment');
select ok(not has_function_privilege('anon', 'public.initiate_reservation_payment(uuid,text,text)', 'EXECUTE'), 'anon cannot initiate payment');
select ok(not has_function_privilege('authenticated', 'public.initiate_reservation_payment(uuid,text,text)', 'EXECUTE'), 'authenticated cannot initiate payment');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P2B-MACHINE-1', 'essential', 'P2B-SERIAL-1', 'available', true);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000c201',
        (select id from public.organisations where slug = 'igloue'),
        'Payment', 'Initiation', 'p2b@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    status, delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, delivery_fee, options_total, deposit_amount,
    total_amount, payment_status, idempotency_key
) values (
    '00000000-0000-4000-8000-00000000c101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000c201', 'essential',
    now() + interval '20 days', now() + interval '27 days', 'pending',
    '1 Payment Street', '16000', 'Angouleme', 59.00, 12.00, 4.00, 300.00,
    75.00, 'not_started', 'p2b-reservation-1'
);

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start,
    operational_end, hold_expires_at
) values (
    '00000000-0000-4000-8000-00000000c301',
    '00000000-0000-4000-8000-00000000c101', 'P2B-MACHINE-1', 'held',
    now() + interval '20 days', now() + interval '27 days', now() + interval '30 minutes'
);

insert into public.reservation_payment_capabilities (
    id, organisation_id, reservation_id, capability_hash, expires_at
) values (
    '00000000-0000-4000-8000-00000000c401',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000c101',
    '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    now() + interval '30 minutes'
);

create temporary table p2b_first as
select * from public.initiate_reservation_payment(
    '00000000-0000-4000-8000-00000000c101',
    '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'p2b-key-a'
);

select is((select organisation_id from p2b_first), (select id from public.organisations where slug = 'igloue'), 'attempt uses reservation organisation');
select is((select amount from p2b_first), 75.00::numeric, 'amount is copied from reservation total_amount');
select is((select currency from p2b_first), 'EUR', 'currency is fixed to EUR');
select is((select attempt_status from p2b_first), 'created', 'attempt starts created');
select ok((select reused = false from p2b_first), 'first initiation is not marked reused');
select ok((select not exists (select 1 from p2b_first where payment_attempt_id is null)), 'payment attempt id is returned');
select ok((select not exists (select 1 from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101' and amount = 300.00)), 'deposit is excluded from payable amount');
select ok((select provider = 'stripe' and purpose = 'rental' and status = 'created' and provider_checkout_session_id is null and provider_payment_intent_id is null and paid_at is null and refunded_at is null from public.payment_attempts where id = (select payment_attempt_id from p2b_first)), 'attempt uses fixed provider/purpose and has no provider or terminal data');
select is((select count(*)::integer from public.reservation_payment_capabilities where reservation_id = '00000000-0000-4000-8000-00000000c101'), 1, 'capability row remains singular');
select ok((select hold_expires_at > now() + interval '9 minutes' from p2b_first), 'hold expiry is returned without extension');

select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'p2b-invalid')$$, '22023', null, 'malformed capability input is rejected');
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ' ')$$, '22023', null, 'blank idempotency key is rejected');

update public.reservation_payment_capabilities
set created_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 minute'
where reservation_id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-expired')$$, 'P0001', null, 'expired capability is rejected');
update public.reservation_payment_capabilities
set expires_at = now() + interval '30 minutes', revoked_at = now()
where reservation_id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-revoked')$$, 'P0001', null, 'revoked capability is rejected');
update public.reservation_payment_capabilities
set revoked_at = null, used_at = now()
where reservation_id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-used')$$, 'P0001', null, 'used capability is rejected');
update public.reservation_payment_capabilities
set used_at = null;

update public.allocations
set hold_expires_at = now() - interval '1 minute'
where id = '00000000-0000-4000-8000-00000000c301';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-expired-hold')$$, 'P0001', null, 'expired hold is rejected');
update public.allocations
set hold_expires_at = now() + interval '10 minutes';
select lives_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-boundary')$$, 'exactly ten minutes remaining is accepted');
update public.allocations set status = 'released' where id = '00000000-0000-4000-8000-00000000c301';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-nonheld')$$, 'P0001', null, 'non-held allocation is rejected');
update public.allocations set status = 'held', hold_expires_at = now() + interval '30 minutes' where id = '00000000-0000-4000-8000-00000000c301';

update public.reservations set status = 'confirmed' where id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-confirmed')$$, 'P0001', null, 'non-pending reservation is rejected');
update public.reservations set status = 'pending', payment_status = 'paid' where id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-paid')$$, 'P0001', null, 'paid reservation is rejected');
update public.reservations set payment_status = 'requires_review' where id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-review')$$, 'P0001', null, 'requires-review reservation is rejected');
update public.reservations set payment_status = 'refunded' where id = '00000000-0000-4000-8000-00000000c101';
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-refunded')$$, 'P0001', null, 'refunded reservation is rejected');
update public.reservations set payment_status = 'not_started' where id = '00000000-0000-4000-8000-00000000c101';

select is((select count(*)::integer from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101'), 1, 'invalid initiation creates no attempt');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000c101'), 'not_started', 'payment status remains not_started');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000c101'), 'pending', 'reservation status remains pending');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000c301'), 'held', 'allocation status remains held');

create temporary table p2b_same_key as
select * from public.initiate_reservation_payment(
    '00000000-0000-4000-8000-00000000c101',
    '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'p2b-key-a'
);
select is((select payment_attempt_id from p2b_same_key), (select payment_attempt_id from p2b_first), 'same key reuses the active attempt');
select ok((select reused from p2b_same_key), 'same-key reuse is marked reused');
select is((select idempotency_key from public.payment_attempts where id = (select payment_attempt_id from p2b_same_key)), 'p2b-key-a', 'reused attempt keeps original idempotency key');

create temporary table p2b_different_key as
select * from public.initiate_reservation_payment(
    '00000000-0000-4000-8000-00000000c101',
    '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'p2b-key-b'
);
select is((select payment_attempt_id from p2b_different_key), (select payment_attempt_id from p2b_first), 'different key reuses the active attempt');
select is((select count(*)::integer from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101'), 1, 'sequential different keys converge on one active attempt');

update public.payment_attempts set status = 'failed' where id = (select payment_attempt_id from p2b_first);
select throws_ok($$select * from public.initiate_reservation_payment('00000000-0000-4000-8000-00000000c101', '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'p2b-key-a')$$, 'P0001', null, 'same failed key is not silently reset');

create temporary table p2b_retry as
select * from public.initiate_reservation_payment(
    '00000000-0000-4000-8000-00000000c101',
    '\\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'p2b-key-c'
);
select ok((select payment_attempt_id <> (select payment_attempt_id from p2b_first) from p2b_retry), 'new key after failure creates a new attempt');
select is((select status from public.payment_attempts where id = (select payment_attempt_id from p2b_first)), 'failed', 'old failed attempt remains failed');
select is((select count(*)::integer from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101'), 2, 'failed history and retry are both retained');

select ok(not exists (select 1 from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101' and provider_checkout_session_id is not null), 'no provider checkout session is generated');
select ok((select expires_at = hold_expires_at from public.reservation_payment_capabilities c join public.allocations a on a.reservation_id = c.reservation_id where c.reservation_id = '00000000-0000-4000-8000-00000000c101'), 'capability expiry remains aligned with hold expiry');
select ok((select has_table_privilege('anon', 'public.payment_attempts', 'SELECT') = false and has_table_privilege('authenticated', 'public.payment_attempts', 'SELECT') = false), 'browser roles cannot read payment attempts');
select ok((select not exists (
    select 1
    from pg_catalog.pg_attribute as a
    where a.attrelid = 'pg_temp.p2b_first'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('capability_hash', 'raw_capability', 'PAYMENT_CAPABILITY_SECRET')
)), 'capability hash and secret are not returned');
select ok((select not exists (select 1 from public.payment_attempts where reservation_id = '00000000-0000-4000-8000-00000000c101' and amount <> 75.00)), 'caller cannot override authoritative amount');

select * from finish();
rollback;

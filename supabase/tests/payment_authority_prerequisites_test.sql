begin;

select plan(39);

select ok(
    exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'payment_provider_events'
          and column_name = 'matched_at'
          and data_type = 'timestamp with time zone'
          and is_nullable = 'YES'
    ),
    'payment provider events expose nullable matched_at'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conname = 'payment_provider_events_match_marker_consistency_check'
    ),
    'matched_at relationship consistency constraint exists'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conname = 'payment_provider_events_match_marker_consistency_check'
          and not convalidated
    ),
    'legacy marker constraint is forward-safe and not fabricated'
);

select ok(
    not (select prosecdef from pg_proc where oid = 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)'::regprocedure),
    'matching RPC remains SECURITY INVOKER'
);

select ok(
    pg_get_functiondef('public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)'::regprocedure)
        like '%matched_at = now()%',
    'matching marker uses database time'
);

select ok(
    position('for update of r' in pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure))
        < position('from public.allocations' in pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure))
        and position('from public.allocations' in pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure))
        < position('from public.payment_attempts as pa' in pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure)),
    'checkout persistence follows reservation, allocations, payment attempt order'
);

select ok(pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure) like '%status = ''checkout_open''%', 'checkout status behavior remains present');
select ok(pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure) like '%provider_checkout_session_id%', 'Checkout Session persistence behavior remains present');
select ok(pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure) like '%provider_payment_intent_id = coalesce%', 'PaymentIntent persistence behavior remains present');
select ok(pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure) like '%v_state.eligible%', 'Checkout eligibility result behavior remains present');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-4000-8000-00000000f102',
    (select id from public.organisations where slug = 'igloue'),
    'P3E2', 'Matching', 'p3e2-matching@example.test'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000f101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000f102', 'essential',
    now() + interval '20 days', now() + interval '27 days',
    '1 P3E2 Street', '16000', 'Angouleme', 59.00, 75.00,
    'not_started', 'p3e2-matching-reservation'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E2-MATCH-MACHINE', 'essential', 'P3E2-MATCH-SERIAL', 'available', true);

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start,
    operational_end, hold_expires_at
)
values (
    '00000000-0000-4000-8000-00000000f103',
    '00000000-0000-4000-8000-00000000f101', 'P3E2-MATCH-MACHINE', 'held',
    now() + interval '20 days', now() + interval '27 days', now() + interval '30 minutes'
);

insert into public.payment_attempts (
    id, organisation_id, reservation_id, provider, purpose,
    amount, currency, status, idempotency_key, provider_checkout_session_id
)
values (
    '00000000-0000-4000-8000-00000000f104',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000f101', 'stripe', 'rental',
    75.00, 'EUR', 'checkout_open', 'p3e2-matching-attempt', 'cs_p3e2_match'
);

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3e2_match', 'checkout.session.completed',
    to_timestamp(1800000100), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select ok(
    (select matched_at is null from public.payment_provider_events where provider_event_id = 'evt_p3e2_match'),
    'new durable receipt starts without a match marker'
);

select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_match', 'cs_p3e2_match', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_match',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )),
    'matched',
    'successful P3D3 match remains successful'
);

select ok(
    (select payment_attempt_id is not null and organisation_id is not null and matched_at is not null
     from public.payment_provider_events where provider_event_id = 'evt_p3e2_match'),
    'linkage and matched_at are written together'
);

create temporary table original_match_marker as
select matched_at from public.payment_provider_events where provider_event_id = 'evt_p3e2_match';

select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_match', 'cs_p3e2_match', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_match',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )),
    'already_matched',
    'coherent replay remains already_matched'
);

select is(
    (select matched_at from public.payment_provider_events where provider_event_id = 'evt_p3e2_match'),
    (select matched_at from original_match_marker),
    'coherent replay preserves the original matched_at'
);

select ok(
    (select status = 'checkout_open' and paid_at is null from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f104'),
    'matched_at does not mark payment paid'
);

select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f101'), 'not_started', 'matched_at does not change reservation payment status');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f101'), 'pending', 'matched_at does not confirm reservation');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f103'), 'held', 'matched_at does not reserve allocation');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f101'), 0, 'matching does not create a business outbox event');

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3e2_invalid', 'checkout.session.completed',
    to_timestamp(1800000101), false,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_invalid', 'cs_p3e2_match', 7501, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_match',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )), 'validation_failed', 'validation failure is rejected');
select ok((select matched_at is null from public.payment_provider_events where provider_event_id = 'evt_p3e2_invalid'), 'validation failure leaves marker null');

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3e2_unknown_session', 'checkout.session.completed',
    to_timestamp(1800000102), false,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_unknown_session', 'cs_p3e2_unknown', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_unknown',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )), 'unknown_checkout_session', 'unknown Checkout Session is rejected');
select ok((select matched_at is null from public.payment_provider_events where provider_event_id = 'evt_p3e2_unknown_session'), 'unknown Checkout Session leaves marker null');

select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_missing', 'cs_p3e2_match', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_match',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )), 'unknown_provider_event', 'unknown provider event is rejected');

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3e2_conflict', 'checkout.session.completed',
    to_timestamp(1800000103), false,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);
update public.payment_provider_events
set status = 'failed', conflict_detected_at = now(), last_error_code = 'conflicting_payload_digest'
where provider_event_id = 'evt_p3e2_conflict';
select is(
    (select outcome from public.match_payment_provider_event(
        'evt_p3e2_conflict', 'cs_p3e2_match', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e2_match',
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f104'::uuid,
        '00000000-0000-4000-8000-00000000f101'::uuid, false
    )), 'conflict', 'digest-conflicted event cannot match');
select ok((select matched_at is null from public.payment_provider_events where provider_event_id = 'evt_p3e2_conflict'), 'digest-conflicted event keeps marker null');

select throws_ok($$
    insert into public.payment_provider_events (
        organisation_id, payment_attempt_id, provider, provider_event_id,
        event_type, matched_at
    ) values (null, null, 'stripe', 'evt_p3e2_partial_marker',
        'checkout.session.completed', now())
$$, '23514', null, 'matched_at cannot exist without relationship fields');

select lives_ok($$
    insert into public.payment_provider_events (
        organisation_id, payment_attempt_id, provider, provider_event_id,
        event_type
    ) values ((select id from public.organisations where slug = 'igloue'),
        '00000000-0000-4000-8000-00000000f104', 'stripe', 'evt_p3e2_legacy_link',
        'checkout.session.completed')
$$, 'legacy linked rows remain insert-compatible without fabricated matched_at');

select is((select matched_at from public.payment_provider_events where provider_event_id = 'evt_p3e2_legacy_link'), null::timestamptz, 'legacy linked row remains unmarked');

select ok(
    has_function_privilege('service_role', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('public', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
    'matching permissions remain service_role-only'
);

select ok(
    not (select prosecdef from pg_proc where oid = 'public.cancel_reservation(uuid)'::regprocedure),
    'cancellation remains SECURITY INVOKER'
);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-4000-8000-00000000f302',
    (select id from public.organisations where slug = 'igloue'),
    'P3E2', 'Cancellation', 'p3e2-cancellation@example.test'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000f301',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000f302', 'essential',
    now() + interval '30 days', now() + interval '37 days',
    '2 P3E2 Street', '16000', 'Angouleme', 59.00, 75.00,
    'not_started', 'p3e2-cancellation-reservation'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values
    ('P3E2-CANCEL-MACHINE-1', 'essential', 'P3E2-CANCEL-SERIAL-1', 'available', true),
    ('P3E2-CANCEL-MACHINE-2', 'essential', 'P3E2-CANCEL-SERIAL-2', 'available', true),
    ('P3E2-CANCEL-MACHINE-3', 'essential', 'P3E2-CANCEL-SERIAL-3', 'available', true);

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start,
    operational_end, hold_expires_at
)
values
    ('00000000-0000-4000-8000-00000000f303', '00000000-0000-4000-8000-00000000f301', 'P3E2-CANCEL-MACHINE-1', 'held', now() + interval '30 days', now() + interval '37 days', now() - interval '1 day'),
    ('00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f301', 'P3E2-CANCEL-MACHINE-2', 'reserved', now() + interval '40 days', now() + interval '47 days', now() - interval '2 days'),
    ('00000000-0000-4000-8000-00000000f305', '00000000-0000-4000-8000-00000000f301', 'P3E2-CANCEL-MACHINE-3', 'active', now() + interval '50 days', now() + interval '57 days', now() - interval '3 days');

insert into public.service_jobs (
    reservation_id, job_type, scheduled_date, time_slot,
    address_line_1, postcode, city, status
)
values
    ('00000000-0000-4000-8000-00000000f301', 'delivery', current_date + 30, '0800-1000', '2 P3E2 Street', '16000', 'Angouleme', 'scheduled'),
    ('00000000-0000-4000-8000-00000000f301', 'collection', current_date + 37, '1600-1800', '2 P3E2 Street', '16000', 'Angouleme', 'assigned');

select * from public.cancel_reservation('00000000-0000-4000-8000-00000000f301');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f301'), 'cancelled', 'cancellation preserves reservation status semantics');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f301' and status = 'released'), 3, 'held, reserved, and active allocations are released');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f301' and hold_expires_at is not null), 0, 'released allocations have no stale hold expiry');
select is((select count(*)::integer from public.service_jobs where reservation_id = '00000000-0000-4000-8000-00000000f301' and status = 'cancelled'), 2, 'service-job cancellation behavior is preserved');

select lives_ok($$select * from public.cancel_reservation('00000000-0000-4000-8000-00000000f301')$$, 'repeated cancellation remains idempotent');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f301' and hold_expires_at is not null), 0, 'repeated cancellation keeps hold expiry clear');

select ok(
    not (select pg_get_functiondef('public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)'::regprocedure) ~* 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''paid''')
    and not (select pg_get_functiondef('public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)'::regprocedure) ~* 'paid_at')
    and not (select pg_get_functiondef('public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure) ~* 'paid_at'),
    'P3E2 functions add no paid-state authority'
);

select * from finish();
rollback;

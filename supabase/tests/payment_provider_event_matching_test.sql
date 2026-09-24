begin;

select plan(41);

select ok(to_regprocedure('public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)') is not null,
          'matching RPC exists with the intended signature');
select ok(not has_function_privilege('public', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
          'PUBLIC cannot execute matching RPC');
select ok(not has_function_privilege('anon', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
          'anon cannot execute matching RPC');
select ok(not has_function_privilege('authenticated', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
          'authenticated cannot execute matching RPC');
select ok(has_function_privilege('service_role', 'public.match_payment_provider_event(text,text,bigint,text,text,text,text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
          'service_role can execute matching RPC');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000e201',
        (select id from public.organisations where slug = 'igloue'),
        'Matching', 'Fixture', 'matching@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000e101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000e201', 'essential',
    now() + interval '20 days', now() + interval '27 days',
    '1 Matching Street', '16000', 'Angouleme', 59.00, 75.00,
    'not_started', 'matching-reservation'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3D3-MACHINE-1', 'essential', 'P3D3-SERIAL-1', 'available', true);

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start,
    operational_end, hold_expires_at
)
values (
    '00000000-0000-4000-8000-00000000e301',
    '00000000-0000-4000-8000-00000000e101', 'P3D3-MACHINE-1', 'held',
    now() + interval '20 days', now() + interval '27 days', now() - interval '1 hour'
);

insert into public.payment_attempts (
    id, organisation_id, reservation_id, provider, purpose,
    amount, currency, status, idempotency_key, provider_checkout_session_id
)
values (
    '00000000-0000-4000-8000-00000000e001',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000e101', 'stripe', 'rental',
    75.00, 'EUR', 'checkout_open', 'matching-attempt', 'cs_p3d3_e001'
);

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3d3_match', 'checkout.session.completed',
    to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

create temporary table matching_first as
select * from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment',
    'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
);

select is((select outcome from matching_first), 'matched', 'valid receipt and Session match successfully');
select is((select payment_attempt_id from matching_first), '00000000-0000-4000-8000-00000000e001'::uuid, 'matched attempt is returned');
select is((select reservation_id from matching_first), '00000000-0000-4000-8000-00000000e101'::uuid, 'reservation is derived locally');
select is((select organisation_id from matching_first), (select id from public.organisations where slug = 'igloue'), 'organisation is derived locally');
select ok((select payment_attempt_id is not null and organisation_id is not null from public.payment_provider_events where provider_event_id = 'evt_p3d3_match'), 'provider event is linked as a relationship pair');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_p3d3_match'), 'received', 'matched event remains received');
select is((select provider_event_id from public.payment_provider_events where provider_event_id = 'evt_p3d3_match'), 'evt_p3d3_match', 'event identity is unchanged');
select is((select payload_sha256 from public.payment_provider_events where provider_event_id = 'evt_p3d3_match'), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'event digest is unchanged');
select is((select livemode from public.payment_provider_events where provider_event_id = 'evt_p3d3_match'), false, 'event livemode is unchanged');
select is((select provider_payment_intent_id from public.payment_attempts where id = '00000000-0000-4000-8000-00000000e001'), 'pi_p3d3_e001', 'PaymentIntent identity is persisted');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000e001'), 'checkout_open', 'matching does not mark the attempt paid');
select is((select paid_at from public.payment_attempts where id = '00000000-0000-4000-8000-00000000e001'), null, 'matching does not set paid_at');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000e101'), 'not_started', 'matching does not change reservation payment status');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000e101'), 'pending', 'matching does not confirm reservation');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000e301'), 'held', 'matching does not mutate allocation status');
select ok((select hold_expires_at is not null from public.allocations where id = '00000000-0000-4000-8000-00000000e301'), 'matching does not clear hold expiry');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000e101'), 0, 'matching does not create business outbox events');

select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'already_matched', 'same event replay is idempotent');

select is((select outcome from public.match_payment_provider_event(
    'evt_unknown_p3d3', 'cs_unknown_p3d3', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_unknown',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'unknown_provider_event', 'unknown durable event is rejected');

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3d3_unknown_session', 'checkout.session.completed',
    to_timestamp(1800000001), false,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_unknown_session', 'cs_unknown_p3d3', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_unknown',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'unknown_checkout_session', 'unknown Checkout Session does not fall back to metadata');
select ok((select payment_attempt_id is null and organisation_id is null from public.payment_provider_events where provider_event_id = 'evt_p3d3_unknown_session'), 'unknown Session is not linked');

select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7501, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'wrong amount is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'gbp', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'wrong currency is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'setup', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'wrong mode is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'open', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'wrong Checkout status is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'unpaid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'unpaid Checkout is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_other',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'conflict', 'different PaymentIntent is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'validation_failed', 'wrong client reference is rejected');
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, true
)), 'validation_failed', 'livemode mismatch is rejected');

select * from public.receive_payment_provider_event(
    'stripe', 'evt_p3d3_conflict', 'checkout.session.completed',
    to_timestamp(1800000002), false,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
update public.payment_provider_events
set conflict_detected_at = now(), status = 'failed', last_error_code = 'conflicting_payload_digest'
where provider_event_id = 'evt_p3d3_conflict';
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_conflict', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'conflict', 'digest-conflicted receipt cannot match');

update public.payment_attempts
set status = 'paid', paid_at = now()
where id = '00000000-0000-4000-8000-00000000e001';
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'already_matched', 'paid attempt is explicitly idempotent');

update public.payment_attempts
set status = 'requires_review'
where id = '00000000-0000-4000-8000-00000000e001';
select is((select outcome from public.match_payment_provider_event(
    'evt_p3d3_match', 'cs_p3d3_e001', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3d3_e001',
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e001'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid, false
)), 'already_matched', 'requires_review attempt is not reset');

select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000e001'), 'requires_review', 'P3D3 never changes attempt state');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000e101'), 'not_started', 'P3D3 never changes reservation payment state');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000e301'), 'held', 'P3D3 never changes allocation state');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000e101'), 0, 'P3D3 never creates a business outbox event');

select * from finish();
rollback;

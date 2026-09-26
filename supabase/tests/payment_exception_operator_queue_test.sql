begin;

select plan(39);

select ok(to_regprocedure('public.list_unresolved_paid_payment_exceptions(integer)') is not null,
          'paid payment exception queue RPC exists');
select ok(has_function_privilege('service_role', 'public.list_unresolved_paid_payment_exceptions(integer)', 'EXECUTE'),
          'service_role can read the queue');
select ok(not has_function_privilege('public', 'public.list_unresolved_paid_payment_exceptions(integer)', 'EXECUTE'),
          'PUBLIC cannot read the queue');
select ok(not has_function_privilege('anon', 'public.list_unresolved_paid_payment_exceptions(integer)', 'EXECUTE'),
          'anon cannot read the queue');
select ok(not has_function_privilege('authenticated', 'public.list_unresolved_paid_payment_exceptions(integer)', 'EXECUTE'),
          'authenticated customers cannot read the queue');
select is(pg_get_function_arguments('public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure),
          'p_limit integer DEFAULT 25', 'limit is the only caller-controlled input');
select ok((select prosecdef = false and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure),
          'queue RPC is read-only invoker security with a hardened search path');
select ok(pg_get_functiondef('public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure)
          like '%greatest(coalesce(p_limit, 25), 1), 50%',
          'queue result limit is clamped to at most fifty');
select ok(not (
              pg_get_function_result('public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure) ilike '%payload%'
              or pg_get_function_result('public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure) ilike '%secret%'
              or pg_get_function_result('public.list_unresolved_paid_payment_exceptions(integer)'::regprocedure) ilike '%error_body%'
          ),
          'queue result excludes raw provider payloads, secrets, and error bodies');

insert into public.customers (id, organisation_id, first_name, last_name, email, phone)
values
 ('00000000-0000-4000-8000-00000000f101', (select id from public.organisations where slug = 'igloue'), 'Queue', 'Oldest', 'queue-oldest@example.test', '+33111111111'),
 ('00000000-0000-4000-8000-00000000f102', (select id from public.organisations where slug = 'igloue'), 'Queue', 'Newest', 'queue-newest@example.test', '+33222222222'),
 ('00000000-0000-4000-8000-00000000f103', (select id from public.organisations where slug = 'igloue'), 'Queue', 'Paid', 'queue-paid@example.test', '+33333333333'),
 ('00000000-0000-4000-8000-00000000f104', (select id from public.organisations where slug = 'igloue'), 'Queue', 'Unmatched', 'queue-unmatched@example.test', '+33444444444');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key, recipient_first_name, recipient_last_name, recipient_phone
)
values
 ('00000000-0000-4000-8000-00000000f201', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f101', 'essential', 1, '2047-01-01 12:00+00', '2047-01-08 12:00+00', 'pending', '1 Queue Street', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'queue-oldest-reservation', 'Recipient', 'Oldest', '+33555555555'),
 ('00000000-0000-4000-8000-00000000f202', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f102', 'essential', 1, '2047-02-01 12:00+00', '2047-02-08 12:00+00', 'pending', '2 Queue Street', '16000', 'Angouleme', 59.00, 89.00, 'not_started', 'queue-newest-reservation', 'Recipient', 'Newest', '+33666666666'),
 ('00000000-0000-4000-8000-00000000f203', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f103', 'essential', 1, '2047-03-01 12:00+00', '2047-03-08 12:00+00', 'pending', '3 Queue Street', '16000', 'Angouleme', 59.00, 59.00, 'not_started', 'queue-paid-reservation', null, null, null),
 ('00000000-0000-4000-8000-00000000f204', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f104', 'essential', 1, '2047-04-01 12:00+00', '2047-04-08 12:00+00', 'pending', '4 Queue Street', '16000', 'Angouleme', 59.00, 44.00, 'not_started', 'queue-unmatched-reservation', null, null, null);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E6B-QUEUE-A', 'essential', 'P3E6B-QUEUE-A', 'available', true),
       ('P3E6B-QUEUE-B', 'essential', 'P3E6B-QUEUE-B', 'available', true),
       ('P3E6B-QUEUE-PAID', 'essential', 'P3E6B-QUEUE-PAID', 'available', true),
       ('P3E6B-QUEUE-UNMATCHED', 'essential', 'P3E6B-QUEUE-UNMATCHED', 'available', true);

insert into public.allocations (id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
values
 ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f201', 'P3E6B-QUEUE-A', 'held', '2047-01-01 12:00+00', '2047-01-08 12:00+00', now() - interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f302', '00000000-0000-4000-8000-00000000f202', 'P3E6B-QUEUE-B', 'held', '2047-02-01 12:00+00', '2047-02-08 12:00+00', now() - interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f303', '00000000-0000-4000-8000-00000000f203', 'P3E6B-QUEUE-PAID', 'held', '2047-03-01 12:00+00', '2047-03-08 12:00+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f204', 'P3E6B-QUEUE-UNMATCHED', 'held', '2047-04-01 12:00+00', '2047-04-08 12:00+00', now() + interval '1 hour');

insert into public.service_jobs (id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status)
values
 ('00000000-0000-4000-8000-00000000f401', '00000000-0000-4000-8000-00000000f203', 'delivery', '2047-03-01', '0830-1030', '3 Queue Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f402', '00000000-0000-4000-8000-00000000f203', 'collection', '2047-03-08', '1630-1830', '3 Queue Street', '16000', 'Angouleme', 'scheduled');

insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
values
 ('00000000-0000-4000-8000-00000000f501', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f201', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'queue-oldest-attempt', 'cs_queue_oldest', 'pi_queue_oldest'),
 ('00000000-0000-4000-8000-00000000f502', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f202', 'stripe', 'rental', 89.00, 'EUR', 'checkout_open', 'queue-newest-attempt', 'cs_queue_newest', 'pi_queue_newest'),
 ('00000000-0000-4000-8000-00000000f503', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f203', 'stripe', 'rental', 59.00, 'EUR', 'checkout_open', 'queue-paid-attempt', 'cs_queue_paid', 'pi_queue_paid'),
 ('00000000-0000-4000-8000-00000000f504', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f204', 'stripe', 'rental', 44.00, 'EUR', 'checkout_open', 'queue-unmatched-attempt', 'cs_queue_unmatched', 'pi_queue_unmatched');

select * from public.receive_payment_provider_event('stripe', 'evt_queue_oldest', 'checkout.session.completed', to_timestamp(1800000001), false, repeat('a', 64));
select * from public.receive_payment_provider_event('stripe', 'evt_queue_newest', 'checkout.session.completed', to_timestamp(1800000002), false, repeat('b', 64));
select * from public.receive_payment_provider_event('stripe', 'evt_queue_paid', 'checkout.session.completed', to_timestamp(1800000003), false, repeat('c', 64));
select * from public.receive_payment_provider_event('stripe', 'evt_queue_unmatched', 'checkout.session.completed', to_timestamp(1800000004), false, repeat('d', 64));

select * from public.match_payment_provider_event('evt_queue_oldest', 'cs_queue_oldest', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_queue_oldest', '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f201', false);
select * from public.match_payment_provider_event('evt_queue_newest', 'cs_queue_newest', 8900, 'eur', 'payment', 'complete', 'paid', 'pi_queue_newest', '00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f202', false);
select * from public.match_payment_provider_event('evt_queue_paid', 'cs_queue_paid', 5900, 'eur', 'payment', 'complete', 'paid', 'pi_queue_paid', '00000000-0000-4000-8000-00000000f503', '00000000-0000-4000-8000-00000000f503', '00000000-0000-4000-8000-00000000f203', false);

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_queue_oldest'))), 'requires_review', 'valid paid event with expired hold creates a queue case');
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_queue_newest'))), 'requires_review', 'second valid paid event with expired hold creates another queue case');
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_queue_paid'))), 'paid_confirmed', 'normal valid payment confirms and is not a queue case');

update public.payment_exceptions set created_at = now() - interval '1 hour'
where payment_attempt_id = '00000000-0000-4000-8000-00000000f501';
update public.payment_exceptions set created_at = now() - interval '30 minutes'
where payment_attempt_id = '00000000-0000-4000-8000-00000000f502';

select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions()), 2,
          'queue contains only unresolved paid review exceptions');
select is((select array_agg(payment_attempt_id::text order by created_at, exception_id)
           from public.list_unresolved_paid_payment_exceptions()),
          array['00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f502']::text[],
          'oldest unresolved case is first with deterministic tie-breaking');
select is((select exception_id from public.list_unresolved_paid_payment_exceptions(1) limit 1),
          (select id from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          'queue returns the exception identifier used by audited resolution');
select is((select amount from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          75.00::numeric, 'queue amount comes from the authoritative payment attempt');
select is((select currency from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          'EUR', 'queue currency comes from the authoritative payment attempt');
select is((select customer_name from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          'Recipient Oldest', 'operator name uses the reservation recipient snapshot');
select is((select customer_email from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          'queue-oldest@example.test', 'queue exposes the linked customer email');
select is((select customer_phone from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'),
          '+33555555555', 'operator phone uses the reservation recipient snapshot');
select ok(not exists (
    select 1 from public.list_unresolved_paid_payment_exceptions() as q
    join public.reservations as r on r.id = q.reservation_id
    join public.payment_attempts as pa on pa.id = q.payment_attempt_id
    join public.payment_provider_events as pe on pe.id = q.source_provider_event_id
    where q.organisation_id <> r.organisation_id
       or q.organisation_id <> pa.organisation_id
       or q.reservation_id <> pa.reservation_id
       or q.organisation_id <> pe.organisation_id
       or q.payment_attempt_id <> pe.payment_attempt_id
), 'queue tenant, reservation, attempt, and event links remain coherent');
select ok(not exists (select 1 from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id in ('00000000-0000-4000-8000-00000000f503', '00000000-0000-4000-8000-00000000f504')),
          'paid-confirmed and unmatched events are excluded');
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions(0)), 1,
          'caller limit is clamped to at least one');
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions(null)), 2,
          'default bounded limit applies when omitted or null');

set local role service_role;
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions()), 2,
          'service-role invocation can read the authoritative queue');
reset role;

select is((select count(*)::integer from public.payment_exceptions where status = 'unresolved'), 2,
          'queue read does not mutate exception status');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f501'), 'requires_review',
          'queue read does not mutate payment state');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f201'), 'pending',
          'queue read does not mutate reservation lifecycle');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f301'), 'held',
          'queue read does not mutate inventory');
select is((select count(*)::integer from public.outbox_events), 1,
          'queue read creates no outbox events');

select * from public.receive_payment_provider_event('stripe', 'evt_queue_oldest_replay', 'checkout.session.completed', to_timestamp(1800000005), false, repeat('e', 64));
select * from public.match_payment_provider_event('evt_queue_oldest_replay', 'cs_queue_oldest', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_queue_oldest', '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f201', false);
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_queue_oldest_replay'))), 'already_requires_review',
          'another valid replay remains idempotent');
select is((select count(*)::integer from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'), 1,
          'provider-event replay does not duplicate exception authority');
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions()), 2,
          'provider-event replay does not duplicate a queue item');

select is((select outcome from public.resolve_payment_exception((select exception_id from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f501'), (select id from public.organisations where slug = 'igloue'), 'refund_required', 'operator_tool', 'queue-operator', '00000000-0000-4000-8000-00000000f901')), 'resolved',
          'queue exception identifier links to existing audited refund-required resolution');
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions()), 1,
          'resolved refund-required case leaves the open queue');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f501'), 'requires_review',
          'queue-linked refund-required disposition does not mark payment refunded');
select is((select outcome from public.resolve_payment_exception((select exception_id from public.list_unresolved_paid_payment_exceptions() where payment_attempt_id = '00000000-0000-4000-8000-00000000f502'), (select id from public.organisations where slug = 'igloue'), 'no_refund_required', 'operator_tool', 'queue-operator', '00000000-0000-4000-8000-00000000f902')), 'resolved',
          'no-refund-required disposition uses existing resolution authority');
select is((select count(*)::integer from public.list_unresolved_paid_payment_exceptions()), 0,
          'resolved no-refund-required case leaves the open queue');
select is((select count(*)::integer from public.payment_exception_history where payment_attempt_id in ('00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f502')), 2,
          'queue actions remain recorded in append-only resolution history');

select * from finish();
rollback;

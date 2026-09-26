begin;

select plan(45);

select ok(to_regprocedure('public.prepare_payment_refund(uuid,uuid,text,text,uuid)') is not null,
          'refund preparation authority exists');
select ok(to_regprocedure('public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid)') is not null,
          'refund evidence authority exists');
select ok(has_function_privilege('service_role', 'public.prepare_payment_refund(uuid,uuid,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('public', 'public.prepare_payment_refund(uuid,uuid,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.prepare_payment_refund(uuid,uuid,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.prepare_payment_refund(uuid,uuid,text,text,uuid)', 'EXECUTE'),
          'only service_role can prepare a refund');
select ok(has_function_privilege('service_role', 'public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('public', 'public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid)', 'EXECUTE'),
          'only service_role can record refund evidence');
select is(pg_get_function_arguments('public.prepare_payment_refund(uuid,uuid,text,text,uuid)'::regprocedure),
          'p_exception_id uuid, p_organisation_id uuid, p_actor_source text, p_actor_id text, p_idempotency_key uuid',
          'preparation accepts no caller-controlled refund amount or currency');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000c101', (select id from public.organisations where slug = 'igloue'),
        'Refund', 'Fixture', 'refund-fixture@example.test');
insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
) values (
 '00000000-0000-4000-8000-00000000c201', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c101', 'essential', 1, '2048-02-01 12:00+00', '2048-02-08 12:00+00',
 'pending', '1 Refund Street', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'refund-foundation-reservation');
insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
) values (
 '00000000-0000-4000-8000-00000000c202', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c101', 'essential', 1, '2048-03-01 12:00+00', '2048-03-08 12:00+00',
 'pending', '2 Refund Street', '16000', 'Angouleme', 59.00, 75.00, 'requires_review', 'refund-foundation-unresolved-reservation');
insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E4C1-REFUND-MACHINE', 'essential', 'P3E4C1-REFUND-SERIAL', 'available', true);
insert into public.allocations (id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
values ('00000000-0000-4000-8000-00000000c301', '00000000-0000-4000-8000-00000000c201',
        'P3E4C1-REFUND-MACHINE', 'held', '2048-02-01 12:00+00', '2048-02-08 12:00+00', now() - interval '1 hour');
insert into public.service_jobs (id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status)
values ('00000000-0000-4000-8000-00000000c401', '00000000-0000-4000-8000-00000000c201', 'delivery', '2048-02-01', '0830-1030', '1 Refund Street', '16000', 'Angouleme', 'scheduled'),
       ('00000000-0000-4000-8000-00000000c402', '00000000-0000-4000-8000-00000000c201', 'collection', '2048-02-08', '1630-1830', '1 Refund Street', '16000', 'Angouleme', 'scheduled');
insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
) values (
 '00000000-0000-4000-8000-00000000c501', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c201', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open',
 'refund-foundation-attempt', 'cs_p3e4c1_refund', 'pi_p3e4c1_refund');
insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status, paid_at,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
) values (
 '00000000-0000-4000-8000-00000000c502', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c202', 'stripe', 'rental', 75.00, 'EUR', 'requires_review', now(),
 'refund-foundation-unresolved-attempt', 'cs_p3e4c1_unresolved', 'pi_p3e4c1_unresolved');
insert into public.payment_provider_events (
 id, organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status,
 provider_event_created_at, livemode, payload_sha256, matched_at, processed_at
) values (
 '00000000-0000-4000-8000-00000000c602', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c502', 'stripe', 'evt_p3e4c1_unresolved', 'checkout.session.completed',
 'processed', to_timestamp(1800001001), false,
 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', now(), now());
insert into public.payment_exceptions (
 id, organisation_id, reservation_id, payment_attempt_id, source_provider_event_id, reason_code
) values (
 '00000000-0000-4000-8000-00000000c702', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000c202', '00000000-0000-4000-8000-00000000c502',
 '00000000-0000-4000-8000-00000000c602', 'confirmation_ineligible');
select * from public.receive_payment_provider_event('stripe', 'evt_p3e4c1_refund', 'checkout.session.completed',
    to_timestamp(1800001000), false, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select * from public.match_payment_provider_event('evt_p3e4c1_refund', 'cs_p3e4c1_refund', 7500, 'eur', 'payment',
    'complete', 'paid', 'pi_p3e4c1_refund', '00000000-0000-4000-8000-00000000c501',
    '00000000-0000-4000-8000-00000000c501', '00000000-0000-4000-8000-00000000c201', false);
select is((select outcome from public.apply_provider_payment_outcome(
    (select id from public.payment_provider_events where provider_event_id = 'evt_p3e4c1_refund'))),
    'requires_review', 'fixture has authoritative paid evidence awaiting review');
select is((select outcome from public.resolve_payment_exception(
    (select id from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 'refund_required', 'operator_tool', 'refund-operator',
    '00000000-0000-4000-8000-00000000c901')), 'resolved', 'fixture exception is resolved refund_required');
select throws_ok($$select * from public.prepare_payment_refund(
    '00000000-0000-4000-8000-00000000c702',
    (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
    '00000000-0000-4000-8000-00000000c906')$$, 'P0001', null::text,
    'unresolved exception cannot create a refund record');
select is((select count(*)::integer from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c502'),
    0, 'no refund exists before compatible exception resolution');

select is((select outcome from public.prepare_payment_refund(
    (select id from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
    '00000000-0000-4000-8000-00000000c902')), 'prepared', 'eligible exception prepares a refund');
select is((select count(*)::integer from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    1, 'preparation creates exactly one refund record');
select is((select amount from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    75.00::numeric, 'refund amount is copied from authoritative paid attempt');
select is((select currency from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    'EUR', 'refund currency is copied from authoritative paid attempt');
select is((select status from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    'prepared', 'preparation does not claim provider refund success');
select is((select outcome from public.prepare_payment_refund(
    (select id from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
    '00000000-0000-4000-8000-00000000c902')), 'already_prepared', 'exact preparation replay is idempotent');
select throws_ok($$select * from public.prepare_payment_refund(
    (select id from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    '00000000-0000-4000-8000-00000000ffff', 'operator_tool', 'refund-preparer',
    '00000000-0000-4000-8000-00000000c903')$$, 'P0002', null::text, 'cross-organisation preparation is rejected');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c501'),
    'requires_review', 'preparation leaves payment attempt unrefunded');
select is((select refunded_at from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c501'),
    null::timestamptz, 'preparation does not set refunded_at');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000c201'),
    'requires_review', 'preparation leaves reservation payment state unchanged');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000c201'),
    'pending', 'preparation leaves reservation lifecycle unchanged');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000c301'),
    'held', 'preparation leaves allocation unchanged');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000c201' and event_type = 'reservation.confirmed'),
    0, 'review and preparation create no reservation.confirmed outbox event');
select is((select outcome from public.record_payment_refund_evidence(
    (select id from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 're_p3e4c1_refund_001', 'succeeded',
    'stripe_api', 'operator_tool', 'refund-recorder', '00000000-0000-4000-8000-00000000c904')),
    'succeeded', 'success evidence finalizes the refund');
select is((select status from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    'succeeded', 'refund record stores successful provider outcome');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c501'),
    'refunded', 'only successful refund evidence marks the attempt refunded');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000c201'),
    'refunded', 'reservation payment state atomically follows successful refund evidence');
select ok((select refunded_at is not null and refunded_at <= clock_timestamp()
           from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c501'),
          'refunded_at is database authoritative');
select is((select outcome from public.record_payment_refund_evidence(
    (select id from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 're_p3e4c1_refund_001', 'succeeded',
    'stripe_api', 'operator_tool', 'refund-recorder', '00000000-0000-4000-8000-00000000c904')),
    'already_recorded', 'exact provider-evidence replay is idempotent');
select throws_ok($$select * from public.record_payment_refund_evidence(
    (select id from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    (select id from public.organisations where slug = 'igloue'), 're_p3e4c1_conflict', 'failed',
    'stripe_api', 'operator_tool', 'refund-recorder', '00000000-0000-4000-8000-00000000c905')$$,
    'P0001', null::text, 'conflicting second provider evidence is rejected');
select is((select refunded_at from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c501'),
    (select finalized_at from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    'database finalization timestamp is stable on replay');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000c201'),
    'pending', 'refund finalization does not alter reservation lifecycle');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000c301'),
    'held', 'refund finalization does not release or reallocate inventory');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000c201' and event_type = 'reservation.confirmed'),
    0, 'refund finalization does not enqueue reservation.confirmed');
select is((select count(*)::integer from public.payment_refund_history where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    2, 'refund preparation and success each append one history row');
select is((select string_agg(action, ',' order by occurred_at, id) from public.payment_refund_history
           where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'),
    'prepared,succeeded', 'history records prepared and succeeded transitions in order');
select throws_ok($$update public.payment_refund_history set actor_id = 'rewritten' where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'$$,
    '42501', 'payment refund history is append-only', 'refund audit history cannot be rewritten');
select throws_ok($$delete from public.payment_refund_history where payment_attempt_id = '00000000-0000-4000-8000-00000000c501'$$,
    '42501', 'payment refund history is append-only', 'refund audit history cannot be deleted');
select ok(not has_table_privilege('public', 'public.payment_refund_history', 'UPDATE')
          and not has_table_privilege('public', 'public.payment_refund_history', 'DELETE')
          and not has_table_privilege('anon', 'public.payment_refund_history', 'SELECT')
          and not has_table_privilege('authenticated', 'public.payment_refund_history', 'SELECT')
          and not has_table_privilege('service_role', 'public.payment_refund_history', 'INSERT'),
          'ordinary roles cannot read or mutate refund history');
select ok(not has_table_privilege('service_role', 'public.payment_refunds', 'INSERT')
          and not has_table_privilege('service_role', 'public.payment_refunds', 'UPDATE')
          and not has_table_privilege('service_role', 'public.payment_refunds', 'DELETE')
          and not has_table_privilege('anon', 'public.payment_refunds', 'SELECT')
          and not has_table_privilege('authenticated', 'public.payment_refunds', 'SELECT'),
          'refund records are readable only by service_role and writable only through RPC authority');

select is((select outcome from public.resolve_payment_exception(
    '00000000-0000-4000-8000-00000000c702',
    (select id from public.organisations where slug = 'igloue'), 'refund_required', 'operator_tool', 'refund-operator',
    '00000000-0000-4000-8000-00000000c907')), 'resolved', 'second fixture exception is explicitly resolved');
select is((select outcome from public.prepare_payment_refund(
    '00000000-0000-4000-8000-00000000c702',
    (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
    '00000000-0000-4000-8000-00000000c908')), 'prepared', 'second compatible exception can be prepared');
select is((select outcome from public.record_payment_refund_evidence(
    (select id from public.payment_refunds where payment_attempt_id = '00000000-0000-4000-8000-00000000c502'),
    (select id from public.organisations where slug = 'igloue'), 're_p3e4c1_refund_failed_001', 'failed',
    'stripe_dashboard_reconciliation', 'operator_tool', 'refund-recorder',
    '00000000-0000-4000-8000-00000000c909')), 'failed', 'failed provider evidence is durably recorded');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000c502'),
    'requires_review', 'failed refund evidence does not mark payment refunded');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000c202'),
    'requires_review', 'failed refund evidence preserves reservation payment review');
select is((select string_agg(action, ',' order by occurred_at, id) from public.payment_refund_history
           where payment_attempt_id = '00000000-0000-4000-8000-00000000c502'),
    'prepared,failed', 'failed outcome is preserved as append-only audit history');

select * from finish();
rollback;

begin;

select plan(41);

select ok(to_regprocedure('public.receive_payment_refund_provider_event(text,text,timestamptz,boolean,text,boolean,text,text,bigint,text,text,text)') is not null,
          'normalized refund receipt authority exists');
select ok(to_regprocedure('public.apply_payment_refund_provider_event(uuid)') is not null,
          'refund event uses a dedicated reconciliation authority');
select ok(has_function_privilege('service_role', 'public.apply_payment_refund_provider_event(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.apply_payment_refund_provider_event(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.apply_payment_refund_provider_event(uuid)', 'EXECUTE'),
          'only service_role can reconcile provider refund events');
select ok(not has_table_privilege('anon', 'public.payment_refund_provider_events', 'SELECT')
          and not has_table_privilege('authenticated', 'public.payment_refund_provider_events', 'SELECT'),
          'normalized webhook facts are not browser-readable');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000d101', (select id from public.organisations where slug = 'igloue'),
        'Refund', 'Webhook', 'refund-webhook@example.test');
insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
) values ('00000000-0000-4000-8000-00000000d201', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d101', 'essential', 1, '2049-02-01 12:00+00', '2049-02-08 12:00+00',
 'pending', '1 Refund Street', '16000', 'Angouleme', 59.00, 75.00, 'requires_review', 'refund-webhook-reservation');
insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E4C3-REFUND-MACHINE', 'essential', 'P3E4C3-REFUND-SERIAL', 'available', true);
insert into public.allocations (id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
values ('00000000-0000-4000-8000-00000000d301', '00000000-0000-4000-8000-00000000d201',
        'P3E4C3-REFUND-MACHINE', 'held', '2049-02-01 12:00+00', '2049-02-08 12:00+00', now() - interval '1 hour');
insert into public.service_jobs (id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status)
values ('00000000-0000-4000-8000-00000000d401', '00000000-0000-4000-8000-00000000d201', 'delivery', '2049-02-01', '0830-1030', '1 Refund Street', '16000', 'Angouleme', 'scheduled');
insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status, paid_at,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
) values ('00000000-0000-4000-8000-00000000d501', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d201', 'stripe', 'rental', 75.00, 'EUR', 'requires_review', now(),
 'refund-webhook-attempt', 'cs_p3e4c3_refund', 'pi_p3e4c3refund');
insert into public.payment_provider_events (
 id, organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status,
 provider_event_created_at, livemode, payload_sha256, matched_at, processed_at
) values ('00000000-0000-4000-8000-00000000d601', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d501', 'stripe', 'evt_p3e4c3_payment', 'checkout.session.completed', 'processed',
 to_timestamp(1800000000), false, repeat('a', 64), now(), now());
insert into public.payment_exceptions (id, organisation_id, reservation_id, payment_attempt_id, source_provider_event_id, reason_code)
values ('00000000-0000-4000-8000-00000000d701', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d201', '00000000-0000-4000-8000-00000000d501',
 '00000000-0000-4000-8000-00000000d601', 'confirmation_ineligible');
select * from public.resolve_payment_exception('00000000-0000-4000-8000-00000000d701',
 (select id from public.organisations where slug = 'igloue'), 'refund_required', 'operator_tool', 'refund-operator',
 '00000000-0000-4000-8000-00000000d901');
select * from public.prepare_payment_refund('00000000-0000-4000-8000-00000000d701',
 (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
 '00000000-0000-4000-8000-00000000d902');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
) values ('00000000-0000-4000-8000-00000000d202', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d101', 'essential', 1, '2049-03-01 12:00+00', '2049-03-08 12:00+00',
 'pending', '2 Refund Street', '16000', 'Angouleme', 59.00, 75.00, 'requires_review', 'refund-webhook-reservation-failed');
insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status, paid_at,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
) values ('00000000-0000-4000-8000-00000000d502', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d202', 'stripe', 'rental', 75.00, 'EUR', 'requires_review', now(),
 'refund-webhook-attempt-failed', 'cs_p3e4c3_failed', 'pi_p3e4c3failed');
insert into public.payment_provider_events (
 id, organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status,
 provider_event_created_at, livemode, payload_sha256, matched_at, processed_at
) values ('00000000-0000-4000-8000-00000000d602', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d502', 'stripe', 'evt_p3e4c3_payment_failed', 'checkout.session.completed', 'processed',
 to_timestamp(1800000001), false, repeat('2', 64), now(), now());
insert into public.payment_exceptions (id, organisation_id, reservation_id, payment_attempt_id, source_provider_event_id, reason_code)
values ('00000000-0000-4000-8000-00000000d702', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000d202', '00000000-0000-4000-8000-00000000d502',
 '00000000-0000-4000-8000-00000000d602', 'confirmation_ineligible');
select * from public.resolve_payment_exception('00000000-0000-4000-8000-00000000d702',
 (select id from public.organisations where slug = 'igloue'), 'refund_required', 'operator_tool', 'refund-operator',
 '00000000-0000-4000-8000-00000000d903');
select * from public.prepare_payment_refund('00000000-0000-4000-8000-00000000d702',
 (select id from public.organisations where slug = 'igloue'), 'operator_tool', 'refund-preparer',
 '00000000-0000-4000-8000-00000000d904');

select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_success', 'refund.updated', to_timestamp(1800001000), false, repeat('b',64), false, 're_p3e4c3001', 'pi_p3e4c3refund', 7500, 'eur', 'succeeded', null)),
          'recorded', 'valid success is durably normalized');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_success'))),
          'succeeded', 'known refund reconciles through C1 evidence authority');
select is((select status from public.payment_refunds where payment_attempt_id='00000000-0000-4000-8000-00000000d501'),
          'succeeded', 'success updates the refund ledger');
select is((select status from public.payment_attempts where id='00000000-0000-4000-8000-00000000d501'),
          'refunded', 'only C1 evidence authority updates payment status');
select is((select payment_status from public.reservations where id='00000000-0000-4000-8000-00000000d201'),
          'refunded', 'C1 atomically updates reservation payment status');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_success'))),
          'already_processed', 'exact delivery replay is idempotent');
select is((select count(*)::integer from public.payment_refund_history where refund_id=(select id from public.payment_refunds where payment_attempt_id='00000000-0000-4000-8000-00000000d501')),
          2, 'webhook replay does not duplicate refund history');
select is((select count(*)::integer from public.payment_refund_provider_events where provider_refund_id='re_p3e4c3001'),
          1, 'webhook does not create a second refund ledger record');
select is((select count(*)::integer from public.outbox_events where aggregate_id='00000000-0000-4000-8000-00000000d201' and event_type='reservation.confirmed'),
          0, 'refund reconciliation emits no reservation confirmation');
select is((select status from public.allocations where id='00000000-0000-4000-8000-00000000d301'),
          'held', 'refund reconciliation leaves allocations unchanged');
select is((select status from public.service_jobs where id='00000000-0000-4000-8000-00000000d401'),
          'scheduled', 'refund reconciliation leaves service jobs unchanged');
select ok((select provider_created_at = to_timestamp(1800001000) from public.payment_refund_provider_events where receipt_event_id=(select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_success')),
          'normalized record stores provider timestamp');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_bad_amount', 'refund.updated', to_timestamp(1800001001), false, repeat('c',64), false, 're_p3e4c3001', 'pi_p3e4c3refund', 7400, 'eur', 'succeeded', null)),
          'recorded', 'mismatched event is received for deterministic terminal evaluation');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_bad_amount'))),
          'ignored', 'amount mismatch fails closed');
select is((select status from public.payment_provider_events where provider_event_id='evt_p3e4c3_bad_amount'),
          'ignored', 'deterministic mismatch becomes terminal');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_wrong_pi', 'refund.updated', to_timestamp(1800001002), false, repeat('d',64), false, 're_p3e4c3001', 'pi_wrong123', 7500, 'eur', 'succeeded', null)),
          'recorded', 'wrong intent event is durably received');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_wrong_pi'))),
          'ignored', 'wrong PaymentIntent fails closed');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_pending', 'refund.created', to_timestamp(1800001003), false, repeat('e',64), false, 're_p3e4c3other', 'pi_p3e4c3refund', 7500, 'eur', 'pending', null)),
          'recorded', 'pending provider state is durably received');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_pending'))),
          'pending', 'pending state does not finalize');
select is((select status from public.payment_attempts where id='00000000-0000-4000-8000-00000000d501'),
          'refunded', 'pending replay cannot undo or alter finalized state');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_malformed', 'refund.failed', to_timestamp(1800001004), false, repeat('f',64), false, null, null, null, null, null, 'malformed_refund_event')),
          'ignored', 'malformed signed refund event is durably terminal');
select is((select status from public.payment_provider_events where provider_event_id='evt_p3e4c3_malformed'),
          'ignored', 'malformed event does not enter a retry loop');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_failed', 'refund.failed', to_timestamp(1800001006), false, repeat('2',64), false, 're_p3e4c3failed', 'pi_p3e4c3failed', 7500, 'eur', 'failed', null)),
          'recorded', 'failed refund event is durably received');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_failed'))),
          'failed', 'failed provider outcome uses C1 failure evidence');
select is((select status from public.payment_refunds where payment_attempt_id='00000000-0000-4000-8000-00000000d502'),
          'failed', 'failed evidence is stored on the prepared refund');
select is((select status from public.payment_attempts where id='00000000-0000-4000-8000-00000000d502'),
          'requires_review', 'failed evidence does not mark payment refunded');
select is((select payment_status from public.reservations where id='00000000-0000-4000-8000-00000000d202'),
          'requires_review', 'failed evidence leaves reservation payment state unchanged');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_livemode', 'refund.updated', to_timestamp(1800001007), true, repeat('3',64), false, 're_p3e4c3live', 'pi_p3e4c3refund', 7500, 'eur', 'succeeded', null)),
          'ignored', 'livemode mismatch is terminalized at receipt');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_conflicting', 'refund.updated', to_timestamp(1800001008), false, repeat('4',64), false, 're_p3e4c3001', 'pi_p3e4c3refund', 7500, 'eur', 'failed', null)),
          'recorded', 'conflicting provider outcome is received for authority evaluation');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_conflicting'))),
          'conflict', 'conflicting terminal evidence is rejected');
select is((select count(*)::integer from public.payment_refund_history where refund_id=(select id from public.payment_refunds where payment_attempt_id='00000000-0000-4000-8000-00000000d501')),
          2, 'conflicting event adds no duplicate refund history');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_success', 'refund.updated', to_timestamp(1800001000), false, repeat('9',64), false, 're_p3e4c3001', 'pi_p3e4c3refund', 7500, 'eur', 'succeeded', null)),
          'conflict', 'same Stripe event ID with a changed digest is detected');
select is((select outcome from public.receive_payment_refund_provider_event('evt_p3e4c3_recoverable', 'refund.updated', to_timestamp(1800001009), false, repeat('5',64), false, 're_p3e4c3001', 'pi_p3e4c3refund', 7500, 'eur', 'succeeded', null)),
          'recorded', 'a transiently unfinished receipt remains available for recovery');
select is((select count(*)::integer from public.claim_payment_refund_event_recovery(8, false)
           where event_id=(select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_recoverable')),
          1, 'bounded recovery worker claims the unfinished refund event');
select is((select outcome from public.apply_payment_refund_provider_event((select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_recoverable'))),
          'already_processed', 'recovery safely replays existing C1 evidence');
select is(public.record_payment_provider_event_recovery(
           (select id from public.payment_provider_events where provider_event_id='evt_p3e4c3_recoverable'),
           (select recovery_claim_token from public.payment_provider_events where provider_event_id='evt_p3e4c3_recoverable'),
           'processed', null), 'completed', 'recovery records final authority result and releases its lease');
set local role anon;
select throws_ok($$select * from public.receive_payment_refund_provider_event('evt_p3e4c3_live_mismatch', 'refund.updated', to_timestamp(1800001005), true, repeat('1',64), false, 're_p3e4c3002', 'pi_p3e4c3refund', 7500, 'eur', 'succeeded', null)$$,
    '42501', null::text, 'direct authority call is unavailable to test role');
reset role;

select * from finish();
rollback;








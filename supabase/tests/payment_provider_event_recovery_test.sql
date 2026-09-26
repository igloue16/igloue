begin;

select plan(40);

select ok(to_regprocedure('public.claim_payment_provider_event_recovery(integer,boolean)') is not null,
          'bounded payment-event recovery claim function exists');
select ok(to_regprocedure('public.record_payment_provider_event_recovery(uuid,uuid,text,text)') is not null,
          'claim-token recovery result function exists');
select ok(has_function_privilege('service_role', 'public.claim_payment_provider_event_recovery(integer,boolean)', 'EXECUTE')
          and not has_function_privilege('public', 'public.claim_payment_provider_event_recovery(integer,boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.claim_payment_provider_event_recovery(integer,boolean)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.claim_payment_provider_event_recovery(integer,boolean)', 'EXECUTE'),
          'only service_role can claim payment events for recovery');
select ok(has_function_privilege('service_role', 'public.record_payment_provider_event_recovery(uuid,uuid,text,text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_payment_provider_event_recovery(uuid,uuid,text,text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.record_payment_provider_event_recovery(uuid,uuid,text,text)', 'EXECUTE'),
          'browser roles cannot record recovery results');
select is((select pg_get_function_arguments('public.claim_payment_provider_event_recovery(integer,boolean)'::regprocedure)),
          'p_limit integer, p_expected_livemode boolean', 'claim RPC accepts no caller-controlled organisation or payment data');
select throws_ok($$select * from public.claim_payment_provider_event_recovery(0, false)$$,
          '22023', 'recovery claim requires limit 1..20 and expected livemode', 'zero-sized claim is rejected');
select throws_ok($$select * from public.claim_payment_provider_event_recovery(21, false)$$,
          '22023', 'recovery claim requires limit 1..20 and expected livemode', 'oversized claim is rejected');
select throws_ok($$select * from public.claim_payment_provider_event_recovery(1, null::boolean)$$,
          '22023', 'recovery claim requires limit 1..20 and expected livemode', 'missing expected livemode is rejected');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
 ('00000000-0000-4000-8000-00000000a101', (select id from public.organisations where slug = 'igloue'), 'Recovery', 'Paid', 'recovery-paid@example.test'),
 ('00000000-0000-4000-8000-00000000a102', (select id from public.organisations where slug = 'igloue'), 'Recovery', 'Review', 'recovery-review@example.test');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
)
values
 ('00000000-0000-4000-8000-00000000a201', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'essential', 1, '2050-01-01 12:00+00', '2050-01-08 12:00+00', 'pending', '1 Recovery Road', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'recovery-paid-reservation'),
 ('00000000-0000-4000-8000-00000000a202', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a102', 'essential', 1, '2050-02-01 12:00+00', '2050-02-08 12:00+00', 'pending', '2 Recovery Road', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'recovery-review-reservation');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('RECOVERY-MACHINE-PAID', 'essential', 'RECOVERY-PAID', 'available', true),
       ('RECOVERY-MACHINE-REVIEW', 'essential', 'RECOVERY-REVIEW', 'available', true);

insert into public.allocations (
 id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at
)
values
 ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-00000000a201', 'RECOVERY-MACHINE-PAID', 'held', '2050-01-01 12:00+00', '2050-01-08 12:00+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000a302', '00000000-0000-4000-8000-00000000a202', 'RECOVERY-MACHINE-REVIEW', 'held', '2050-02-01 12:00+00', '2050-02-08 12:00+00', now() - interval '1 hour');

insert into public.service_jobs (
 id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status
)
values
 ('00000000-0000-4000-8000-00000000a401', '00000000-0000-4000-8000-00000000a201', 'delivery', '2050-01-01', '0830-1030', '1 Recovery Road', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000a402', '00000000-0000-4000-8000-00000000a201', 'collection', '2050-01-08', '1630-1830', '1 Recovery Road', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000a403', '00000000-0000-4000-8000-00000000a202', 'delivery', '2050-02-01', '0830-1030', '2 Recovery Road', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000a404', '00000000-0000-4000-8000-00000000a202', 'collection', '2050-02-08', '1630-1830', '2 Recovery Road', '16000', 'Angouleme', 'scheduled');

insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
values
 ('00000000-0000-4000-8000-00000000a501', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a201', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'recovery-paid-attempt', 'cs_recovery_paid', 'pi_recovery_paid'),
 ('00000000-0000-4000-8000-00000000a502', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a202', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'recovery-review-attempt', 'cs_recovery_review', 'pi_recovery_review');

select * from public.receive_payment_provider_event('stripe', 'evt_recovery_paid', 'checkout.session.completed', to_timestamp(1800000010), false,
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select * from public.receive_payment_provider_event('stripe', 'evt_recovery_review', 'checkout.session.completed', to_timestamp(1800000011), false,
 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select * from public.match_payment_provider_event('evt_recovery_paid', 'cs_recovery_paid', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_recovery_paid',
 '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a201', false);
select * from public.match_payment_provider_event('evt_recovery_review', 'cs_recovery_review', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_recovery_review',
 '00000000-0000-4000-8000-00000000a502', '00000000-0000-4000-8000-00000000a502', '00000000-0000-4000-8000-00000000a202', false);

create temporary table recovery_initial_claims on commit drop as
select * from public.claim_payment_provider_event_recovery(2, false);
select is((select count(*)::integer from recovery_initial_claims), 2,
          'bounded recovery claim finds authentic matched unfinished events');
select ok((select count(distinct claim_token)::integer from recovery_initial_claims) = 2,
          'each claimed event receives a unique claim token');
select ok((select bool_and(attempt_count = 1) from recovery_initial_claims),
          'first recovery claim increments the database retry count');
select is((select outcome from public.apply_provider_payment_outcome(
    (select pe.id from public.payment_provider_events as pe where pe.provider_event_id = 'evt_recovery_paid'))),
    'paid_confirmed', 'recovered successful payment uses existing payment authority');
select is(public.record_payment_provider_event_recovery(
    (select pe.id from public.payment_provider_events as pe where pe.provider_event_id = 'evt_recovery_paid'),
    (select c.claim_token from recovery_initial_claims as c join public.payment_provider_events as pe on pe.id = c.event_id where pe.provider_event_id = 'evt_recovery_paid'),
    'processed'), 'completed', 'successful recovery clears its owned lease');
select is((select outcome from public.apply_provider_payment_outcome(
    (select pe.id from public.payment_provider_events as pe where pe.provider_event_id = 'evt_recovery_review'))),
    'requires_review', 'recovery routes expired inventory through existing requires_review authority');
select is(public.record_payment_provider_event_recovery(
    (select pe.id from public.payment_provider_events as pe where pe.provider_event_id = 'evt_recovery_review'),
    (select c.claim_token from recovery_initial_claims as c join public.payment_provider_events as pe on pe.id = c.event_id where pe.provider_event_id = 'evt_recovery_review'),
    'processed'), 'completed', 'review recovery clears its owned lease');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000a501'), 'paid',
          'recovery completes the original payment attempt');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000a201' and event_type = 'reservation.confirmed'), 1,
          'recovery emits only the authority function confirmation event');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000a502'), 'requires_review',
          'recovery preserves review outcome for expired inventory');
select is((select count(*)::integer from public.payment_exceptions where payment_attempt_id = '00000000-0000-4000-8000-00000000a502'), 1,
          'recovered review creates exactly one P3E4A exception');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000a302'), 'held',
          'recovery does not resurrect or change expired inventory');
select is((select count(*)::integer from public.claim_payment_provider_event_recovery(2, false)), 0,
          'processed events are not claimed again');

create temporary table paid_at_before_replay on commit drop as
select paid_at from public.payment_attempts where id = '00000000-0000-4000-8000-00000000a501';
select * from public.receive_payment_provider_event('stripe', 'evt_recovery_replay', 'checkout.session.completed', to_timestamp(1800000012), false,
 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
select * from public.match_payment_provider_event('evt_recovery_replay', 'cs_recovery_paid', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_recovery_paid',
 '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a201', false);
create temporary table replay_claim on commit drop as select * from public.claim_payment_provider_event_recovery(1, false);
select is((select count(*)::integer from replay_claim), 1, 'unfinished valid replay event can be claimed');
select is((select count(*)::integer from public.claim_payment_provider_event_recovery(1, false)), 0,
          'a second worker cannot claim an event while its lease is active');
update public.payment_provider_events
set recovery_lease_until = now() - interval '1 second'
where id = (select event_id from replay_claim);
create temporary table replay_reclaim on commit drop as select * from public.claim_payment_provider_event_recovery(1, false);
select is((select count(*)::integer from replay_reclaim), 1, 'expired recovery lease can be reclaimed');
select ok((select r.claim_token <> c.claim_token and r.attempt_count = 2
           from replay_reclaim as r cross join replay_claim as c),
          'lease reclaim rotates token and advances authoritative attempt count');
select is((select outcome from public.apply_provider_payment_outcome((select event_id from replay_reclaim))),
          'already_paid', 'recovery replay preserves an already-paid final state');
select is(public.record_payment_provider_event_recovery((select event_id from replay_reclaim), (select claim_token from replay_reclaim), 'processed'),
          'completed', 'already-final event recovery completes idempotently');
select is((select paid_at from public.payment_attempts where id = '00000000-0000-4000-8000-00000000a501'),
          (select paid_at from paid_at_before_replay), 'paid_at is unchanged by recovery replay');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000a201' and event_type = 'reservation.confirmed'), 1,
          'recovery replay does not duplicate confirmation outbox events');

select * from public.receive_payment_provider_event('stripe', 'evt_recovery_retry', 'checkout.session.completed', to_timestamp(1800000013), false,
 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
select * from public.match_payment_provider_event('evt_recovery_retry', 'cs_recovery_paid', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_recovery_paid',
 '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a201', false);
create temporary table retry_claim on commit drop as select * from public.claim_payment_provider_event_recovery(1, false);
select is(public.record_payment_provider_event_recovery((select event_id from retry_claim), (select claim_token from retry_claim), 'transient_error', 'authority_rpc_unavailable'),
          'retry_scheduled', 'transient technical failure remains retryable');
select ok((select recovery_attempt_count = 1 and recovery_next_attempt_at > now()
                  and recovery_lease_until is null and recovery_claim_token is null
                  and recovery_error_class = 'authority_rpc_unavailable'
           from public.payment_provider_events where id = (select event_id from retry_claim)),
          'retry metadata is sanitized, persisted, and releases the lease');
update public.payment_provider_events
set recovery_next_attempt_at = now() - interval '1 second'
where id = (select event_id from retry_claim);
create temporary table retry_claim_again on commit drop as select * from public.claim_payment_provider_event_recovery(1, false);
select is((select attempt_count from retry_claim_again), 2,
          'scheduled retry increments attempt count');
update public.payment_provider_events
set recovery_attempt_count = 7,
    recovery_lease_until = now() - interval '1 second',
    recovery_next_attempt_at = now() - interval '1 second'
where id = (select event_id from retry_claim_again);
create temporary table final_retry_claim on commit drop as select * from public.claim_payment_provider_event_recovery(1, false);
select is((select attempt_count from final_retry_claim), 8, 'retry budget is bounded at eight claims');
select is(public.record_payment_provider_event_recovery((select event_id from final_retry_claim), (select claim_token from final_retry_claim), 'transient_error', 'authority_rpc_unavailable'),
          'retry_exhausted', 'retry exhaustion is terminal');
select is((select status from public.payment_provider_events where id = (select event_id from final_retry_claim)), 'ignored',
          'exhausted event cannot hot-loop');
select is((select count(*)::integer from public.claim_payment_provider_event_recovery(1, false)), 0,
          'terminal event is never reclaimed');

select * from public.receive_payment_provider_event('stripe', 'evt_recovery_conflict', 'checkout.session.completed', to_timestamp(1800000014), false,
 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
select * from public.match_payment_provider_event('evt_recovery_conflict', 'cs_recovery_paid', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_recovery_paid',
 '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a201', false);
select * from public.receive_payment_provider_event('stripe', 'evt_recovery_conflict', 'checkout.session.completed', to_timestamp(1800000014), false,
 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
select * from public.receive_payment_provider_event('stripe', 'evt_recovery_unmatched', 'checkout.session.completed', to_timestamp(1800000015), false,
 '1111111111111111111111111111111111111111111111111111111111111111');
select * from public.receive_payment_provider_event('stripe', 'evt_recovery_unsupported', 'checkout.session.expired', to_timestamp(1800000016), false,
 '2222222222222222222222222222222222222222222222222222222222222222');
insert into public.payment_provider_events (
    organisation_id, payment_attempt_id, provider, provider_event_id, event_type,
    status, provider_event_created_at, livemode, payload_sha256, matched_at
) values (
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000a501', 'stripe', 'evt_recovery_wrong_mode',
    'checkout.session.completed', 'received', to_timestamp(1800000017), true,
    '3333333333333333333333333333333333333333333333333333333333333333', now()
);
select is((select count(*)::integer from public.claim_payment_provider_event_recovery(10, false)), 0,
          'digest-conflicted, unmatched, unsupported, processed, and terminal events are excluded');
select is((select count(*)::integer from public.payment_provider_events
           where provider_event_id = 'evt_recovery_wrong_mode' and livemode is distinct from false
             and recovery_claim_token is null), 1,
          'event with a non-matching livemode is not claimed');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_recovery_conflict'), 'failed',
          'recovery does not alter digest-conflict status');
select ok((select recovery_terminal_at is null from public.payment_provider_events where provider_event_id = 'evt_recovery_unmatched'),
          'unmatched receipt is left untouched because normalized evidence is unavailable');

select * from finish();
rollback;

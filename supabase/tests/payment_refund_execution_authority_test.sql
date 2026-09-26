begin;

select plan(12);

select ok(to_regprocedure('public.get_payment_refund_execution(uuid)') is not null,
          'refund execution eligibility RPC exists');
select is(pg_get_function_arguments('public.get_payment_refund_execution(uuid)'::regprocedure),
          'p_refund_id uuid', 'caller can identify only an internal refund UUID');
select ok((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.get_payment_refund_execution(uuid)'::regprocedure),
          'eligibility RPC is security definer with an empty search path');
select ok(has_function_privilege('service_role', 'public.get_payment_refund_execution(uuid)', 'EXECUTE')
          and not has_function_privilege('public', 'public.get_payment_refund_execution(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.get_payment_refund_execution(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.get_payment_refund_execution(uuid)', 'EXECUTE'),
          'eligibility RPC is service-role only');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000e101', (select id from public.organisations where slug = 'igloue'),
        'Execution', 'Fixture', 'refund-execution@example.test');
insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
) values (
 '00000000-0000-4000-8000-00000000e201', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000e101', 'essential', 1, '2049-02-01 12:00+00', '2049-02-08 12:00+00',
 'pending', '1 Execution Street', '16000', 'Angouleme', 59.00, 75.00, 'requires_review', 'refund-execution-reservation');
insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status, paid_at,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
) values (
 '00000000-0000-4000-8000-00000000e301', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000e201', 'stripe', 'rental', 75.00, 'EUR', 'requires_review', now(),
 'refund-execution-attempt', 'cs_refund_execution', 'pi_authoritative_execution');
insert into public.payment_provider_events (
 id, organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status,
 provider_event_created_at, livemode, payload_sha256, matched_at, processed_at
) values (
 '00000000-0000-4000-8000-00000000e401', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000e301', 'stripe', 'evt_refund_execution', 'checkout.session.completed',
 'processed', to_timestamp(1800002000), false,
 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', now(), now());
insert into public.payment_exceptions (
 id, organisation_id, reservation_id, payment_attempt_id, source_provider_event_id, reason_code,
 status, resolution, resolved_at, resolver_source, resolver_actor, resolution_idempotency_key
) values (
 '00000000-0000-4000-8000-00000000e501', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000e301',
 '00000000-0000-4000-8000-00000000e401', 'confirmation_ineligible', 'resolved', 'refund_required', now(),
 'operator_tool', 'execution-fixture', '00000000-0000-4000-8000-00000000e601');
insert into public.payment_refunds (
 id, organisation_id, reservation_id, payment_attempt_id, payment_exception_id, amount, currency,
 resolution_source, resolution_actor, prepared_source, prepared_actor, preparation_idempotency_key
) values (
 '00000000-0000-4000-8000-00000000e701', (select id from public.organisations where slug = 'igloue'),
 '00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000e301',
 '00000000-0000-4000-8000-00000000e501', 75.00, 'EUR', 'operator_tool', 'execution-fixture',
 'operator_tool', 'execution-fixture', '00000000-0000-4000-8000-00000000e801');

select is((select refund_status from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          'prepared', 'prepared refund is executable');
select is((select refund_amount from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          75.00::numeric, 'execution amount comes from the prepared ledger');
select is((select payment_intent_id from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          'pi_authoritative_execution', 'execution identifier comes from the paid attempt');
select is((select reservation_status from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          'pending', 'execution authority reports but does not mutate reservation lifecycle');
select is((select source_provider_event_id from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          '00000000-0000-4000-8000-00000000e401'::uuid, 'execution verifies linked authoritative provider event');
select ok((select source_event_matched_at is not null and attempt_paid_at is not null
                  and attempt_refunded_at is null
                  and reservation_payment_status = 'requires_review'
           from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')),
          'execution rechecks current payment and provider evidence state');
select throws_ok($$select * from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000efff')$$,
    'P0002', null::text, 'unknown refund UUID is unavailable');

update public.payment_refunds set status = 'failed', provider_refund_id = 're_execution_failed',
    evidence_outcome = 'failed', evidence_source = 'stripe_api', evidence_actor_source = 'operator_tool',
    evidence_actor = 'execution-fixture', evidence_idempotency_key = '00000000-0000-4000-8000-00000000e802',
    evidence_recorded_at = clock_timestamp(), finalized_at = clock_timestamp()
where id = '00000000-0000-4000-8000-00000000e701';
select throws_ok($$select * from public.get_payment_refund_execution('00000000-0000-4000-8000-00000000e701')$$,
    'P0001', null::text, 'non-prepared refund is not executable');

select * from finish();
rollback;

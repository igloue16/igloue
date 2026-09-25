begin;

select plan(33);

select ok(to_regprocedure('public.apply_provider_payment_outcome(uuid)') is not null,
          'authoritative payment outcome function exists');
select ok(has_function_privilege('service_role', 'public.apply_provider_payment_outcome(uuid)', 'EXECUTE'),
          'service_role can apply a proven provider outcome');
select ok(not has_function_privilege('public', 'public.apply_provider_payment_outcome(uuid)', 'EXECUTE'),
          'PUBLIC cannot apply a provider outcome');
select ok(not has_function_privilege('anon', 'public.apply_provider_payment_outcome(uuid)', 'EXECUTE'),
          'anon cannot apply a provider outcome');
select ok(not has_function_privilege('authenticated', 'public.apply_provider_payment_outcome(uuid)', 'EXECUTE'),
          'authenticated cannot apply a provider outcome');
select ok((select prosecdef = false and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.apply_provider_payment_outcome(uuid)'::regprocedure),
          'outcome function is invoker-security with an empty search path');
select is((select pg_get_function_arguments('public.apply_provider_payment_outcome(uuid)'::regprocedure)),
          'p_event_id uuid', 'only the internal durable event UUID is accepted');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
 ('00000000-0000-4000-8000-00000000f101', (select id from public.organisations where slug = 'igloue'), 'Outcome', 'Success', 'outcome-success@example.test'),
 ('00000000-0000-4000-8000-00000000f102', (select id from public.organisations where slug = 'igloue'), 'Outcome', 'Review', 'outcome-review@example.test');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
)
values
 ('00000000-0000-4000-8000-00000000f201', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f101', 'essential', 1, '2047-01-01 12:00+00', '2047-01-08 12:00+00', 'pending', '1 Outcome Street', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'outcome-success-reservation'),
 ('00000000-0000-4000-8000-00000000f202', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f102', 'essential', 1, '2047-02-01 12:00+00', '2047-02-08 12:00+00', 'pending', '2 Outcome Street', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'outcome-review-reservation');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E3A-MACHINE-SUCCESS', 'essential', 'P3E3A-SUCCESS', 'available', true),
       ('P3E3A-MACHINE-REVIEW', 'essential', 'P3E3A-REVIEW', 'available', true);

insert into public.allocations (
 id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at
)
values
 ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f201', 'P3E3A-MACHINE-SUCCESS', 'held', '2047-01-01 12:00+00', '2047-01-08 12:00+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f302', '00000000-0000-4000-8000-00000000f202', 'P3E3A-MACHINE-REVIEW', 'held', '2047-02-01 12:00+00', '2047-02-08 12:00+00', now() - interval '1 hour');

insert into public.service_jobs (
 id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status
)
values
 ('00000000-0000-4000-8000-00000000f401', '00000000-0000-4000-8000-00000000f201', 'delivery', '2047-01-01', '0830-1030', '1 Outcome Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f402', '00000000-0000-4000-8000-00000000f201', 'collection', '2047-01-08', '1630-1830', '1 Outcome Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f403', '00000000-0000-4000-8000-00000000f202', 'delivery', '2047-02-01', '0830-1030', '2 Outcome Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f404', '00000000-0000-4000-8000-00000000f202', 'collection', '2047-02-08', '1630-1830', '2 Outcome Street', '16000', 'Angouleme', 'scheduled');

insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
values
 ('00000000-0000-4000-8000-00000000f501', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f201', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'outcome-success-attempt', 'cs_p3e3a_success', 'pi_p3e3a_success'),
 ('00000000-0000-4000-8000-00000000f502', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f202', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'outcome-review-attempt', 'cs_p3e3a_review', 'pi_p3e3a_review');

select * from public.receive_payment_provider_event(
 'stripe', 'evt_p3e3a_success', 'checkout.session.completed', to_timestamp(1800000000), false,
 '1111111111111111111111111111111111111111111111111111111111111111'
);
select * from public.receive_payment_provider_event(
 'stripe', 'evt_p3e3a_review', 'checkout.session.completed', to_timestamp(1800000001), false,
 '2222222222222222222222222222222222222222222222222222222222222222'
);
select * from public.match_payment_provider_event(
 'evt_p3e3a_success', 'cs_p3e3a_success', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_success',
 '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f201', false
);
select * from public.match_payment_provider_event(
 'evt_p3e3a_review', 'cs_p3e3a_review', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_review',
 '00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f202', false
);

select is((select matched_at is not null from public.payment_provider_events where provider_event_id = 'evt_p3e3a_success'), true,
          'positive fixture has the P3D3 durable match marker');
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_success'))),
          'paid_confirmed', 'matched success atomically pays and confirms a valid legacy reservation');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f501'), 'paid', 'successful attempt becomes paid');
select ok((select paid_at is not null from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f501'), 'successful attempt records paid_at');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f201'), 'paid', 'reservation payment status becomes paid');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f201'), 'confirmed', 'valid pending reservation is confirmed');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f301'), 'reserved', 'held allocation becomes reserved');
select is((select hold_expires_at from public.allocations where id = '00000000-0000-4000-8000-00000000f301'), null::timestamptz, 'successful confirmation clears the hold expiry');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_p3e3a_success'), 'processed', 'provider event is marked processed');
select ok((select processed_at is not null from public.payment_provider_events where provider_event_id = 'evt_p3e3a_success'), 'processed event records processed_at');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f201' and event_type = 'reservation.confirmed'), 1,
          'success emits exactly one confirmation outbox event');

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_success'))),
          'already_paid', 'successful replay is idempotent');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f201' and event_type = 'reservation.confirmed'), 1,
          'replay does not duplicate the confirmation outbox event');

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_review'))),
          'requires_review', 'expired held inventory routes proven payment to review');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f502'), 'requires_review', 'review attempt retains paid evidence as requires_review');
select ok((select paid_at is not null from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f502'), 'review attempt records paid_at');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f202'), 'requires_review', 'reservation payment status becomes requires_review');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f202'), 'pending', 'review leaves reservation lifecycle unchanged');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f302'), 'held', 'review leaves allocation unchanged');
select ok((select hold_expires_at < now() from public.allocations where id = '00000000-0000-4000-8000-00000000f302'), 'review leaves expired hold timestamp unchanged');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f202' and event_type = 'reservation.confirmed'), 0,
          'review emits no confirmation outbox event');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_p3e3a_review'), 'processed', 'review outcome processes its proven provider event');
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_review'))),
          'already_requires_review', 'review replay does not upgrade or downgrade state');

select * from public.receive_payment_provider_event(
 'stripe', 'evt_p3e3a_unmatched', 'checkout.session.completed', to_timestamp(1800000002), false,
 '3333333333333333333333333333333333333333333333333333333333333333'
);
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_unmatched'))),
          'not_authoritative', 'unmatched event cannot change payment authority');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_p3e3a_unmatched'), 'received', 'unmatched event remains unprocessed');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f501'), 'paid', 'unmatched event cannot alter an attempt');

select * from finish();
rollback;

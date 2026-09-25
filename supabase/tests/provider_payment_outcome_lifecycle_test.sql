begin;

select plan(14);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
 ('00000000-0000-4000-8000-00000000f701', (select id from public.organisations where slug = 'igloue'), 'Confirmed', 'Replay', 'confirmed-replay@example.test'),
 ('00000000-0000-4000-8000-00000000f702', (select id from public.organisations where slug = 'igloue'), 'Cancelled', 'Late', 'cancelled-late@example.test'),
 ('00000000-0000-4000-8000-00000000f703', (select id from public.organisations where slug = 'igloue'), 'Invalid', 'Job', 'invalid-job@example.test');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
)
values
 ('00000000-0000-4000-8000-00000000f711', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f701', 'essential', 1, '2049-01-01 12:00+00', '2049-01-08 12:00+00', 'pending', '1 Outcome Lane', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'outcome-confirmed-replay'),
 ('00000000-0000-4000-8000-00000000f712', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f702', 'essential', 1, '2049-02-01 12:00+00', '2049-02-08 12:00+00', 'pending', '2 Outcome Lane', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'outcome-cancelled-late'),
 ('00000000-0000-4000-8000-00000000f713', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f703', 'essential', 1, '2049-03-01 12:00+00', '2049-03-08 12:00+00', 'pending', '3 Outcome Lane', '16000', 'Angouleme', 59.00, 75.00, 'not_started', 'outcome-invalid-job');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E3A-LIFE-1', 'essential', 'P3E3A-LIFE-1', 'available', true),
       ('P3E3A-LIFE-2', 'essential', 'P3E3A-LIFE-2', 'available', true),
       ('P3E3A-LIFE-3', 'essential', 'P3E3A-LIFE-3', 'available', true);

insert into public.allocations (
 id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at
)
values
 ('00000000-0000-4000-8000-00000000f721', '00000000-0000-4000-8000-00000000f711', 'P3E3A-LIFE-1', 'held', '2049-01-01 12:00+00', '2049-01-08 12:00+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f722', '00000000-0000-4000-8000-00000000f712', 'P3E3A-LIFE-2', 'held', '2049-02-01 12:00+00', '2049-02-08 12:00+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f723', '00000000-0000-4000-8000-00000000f713', 'P3E3A-LIFE-3', 'held', '2049-03-01 12:00+00', '2049-03-08 12:00+00', now() + interval '1 hour');

insert into public.service_jobs (
 id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status
)
values
 ('00000000-0000-4000-8000-00000000f731', '00000000-0000-4000-8000-00000000f711', 'delivery', '2049-01-01', '0830-1030', '1 Outcome Lane', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f732', '00000000-0000-4000-8000-00000000f711', 'collection', '2049-01-08', '1630-1830', '1 Outcome Lane', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f733', '00000000-0000-4000-8000-00000000f712', 'delivery', '2049-02-01', '0830-1030', '2 Outcome Lane', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f734', '00000000-0000-4000-8000-00000000f712', 'collection', '2049-02-08', '1630-1830', '2 Outcome Lane', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f735', '00000000-0000-4000-8000-00000000f713', 'delivery', '2049-03-01', '0830-1030', '3 Outcome Lane', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f736', '00000000-0000-4000-8000-00000000f713', 'collection', '2049-03-08', '1630-1830', '3 Outcome Lane', '16000', 'Angouleme', 'scheduled');

select * from public.confirm_reservation('00000000-0000-4000-8000-00000000f711');
select * from public.cancel_reservation('00000000-0000-4000-8000-00000000f712');
update public.service_jobs set status = 'in_progress'
where id = '00000000-0000-4000-8000-00000000f736';

insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
values
 ('00000000-0000-4000-8000-00000000f741', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f711', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'outcome-confirmed-replay-attempt', 'cs_p3e3a_confirmed', 'pi_p3e3a_confirmed'),
 ('00000000-0000-4000-8000-00000000f742', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f712', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'outcome-cancelled-attempt', 'cs_p3e3a_cancelled', 'pi_p3e3a_cancelled'),
 ('00000000-0000-4000-8000-00000000f743', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f713', 'stripe', 'rental', 75.00, 'EUR', 'checkout_open', 'outcome-invalid-job-attempt', 'cs_p3e3a_job', 'pi_p3e3a_job');

select * from public.receive_payment_provider_event('stripe', 'evt_p3e3a_confirmed', 'checkout.session.completed', to_timestamp(1800000005), false,
 '6666666666666666666666666666666666666666666666666666666666666666');
select * from public.receive_payment_provider_event('stripe', 'evt_p3e3a_cancelled', 'checkout.session.completed', to_timestamp(1800000006), false,
 '7777777777777777777777777777777777777777777777777777777777777777');
select * from public.receive_payment_provider_event('stripe', 'evt_p3e3a_job', 'checkout.session.completed', to_timestamp(1800000007), false,
 '8888888888888888888888888888888888888888888888888888888888888888');
select * from public.match_payment_provider_event('evt_p3e3a_confirmed', 'cs_p3e3a_confirmed', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_confirmed',
 '00000000-0000-4000-8000-00000000f741', '00000000-0000-4000-8000-00000000f741', '00000000-0000-4000-8000-00000000f711', false);
select * from public.match_payment_provider_event('evt_p3e3a_cancelled', 'cs_p3e3a_cancelled', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_cancelled',
 '00000000-0000-4000-8000-00000000f742', '00000000-0000-4000-8000-00000000f742', '00000000-0000-4000-8000-00000000f712', false);
select * from public.match_payment_provider_event('evt_p3e3a_job', 'cs_p3e3a_job', 7500, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_job',
 '00000000-0000-4000-8000-00000000f743', '00000000-0000-4000-8000-00000000f743', '00000000-0000-4000-8000-00000000f713', false);

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_confirmed'))),
          'paid_already_confirmed', 'coherent confirmed reservation records payment without reconfirming');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f711'), 'confirmed', 'already-confirmed lifecycle is preserved');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f711'), 'paid', 'already-confirmed reservation records paid status');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f721'), 'reserved', 'already-confirmed allocation is not transitioned again');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f711' and event_type = 'reservation.confirmed'), 1,
          'already-confirmed payment does not duplicate its confirmation outbox');

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_cancelled'))),
          'requires_review', 'paid event after cancellation routes to review');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f712'), 'cancelled', 'late payment does not resurrect cancellation');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000f722'), 'released', 'late payment does not reclaim released inventory');
select is((select count(*)::integer from public.service_jobs where reservation_id = '00000000-0000-4000-8000-00000000f712' and status = 'cancelled'), 2,
          'late payment leaves cancelled service jobs unchanged');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f712' and event_type = 'reservation.confirmed'), 0,
          'late payment emits no confirmation outbox');

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_job'))),
          'requires_review', 'in-progress pending job routes provider-paid reservation to review');
select is((select status from public.service_jobs where id = '00000000-0000-4000-8000-00000000f736'), 'in_progress', 'review does not repair an incompatible job');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f713'), 'pending', 'incompatible job leaves reservation lifecycle unchanged');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f743'), 'requires_review', 'incompatible job records proven payment for review');

select * from finish();
rollback;

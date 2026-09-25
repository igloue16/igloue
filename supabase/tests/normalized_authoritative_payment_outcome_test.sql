begin;

select plan(10);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
 ('00000000-0000-4000-8000-00000000f601', (select id from public.organisations where slug = 'igloue'), 'Normalized', 'Paid', 'normalized-paid@example.test'),
 ('00000000-0000-4000-8000-00000000f602', (select id from public.organisations where slug = 'igloue'), 'Normalized', 'Review', 'normalized-review@example.test');

insert into public.reservations (
 id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
 delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
 total_amount, payment_status, idempotency_key
)
values
 ('00000000-0000-4000-8000-00000000f611', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f601', null, 2, '2048-01-01 12:00+00', '2048-01-08 12:00+00', 'pending', '1 Normalized Street', '16000', 'Angouleme', null, 130.00, 'not_started', 'outcome-normalized-paid'),
 ('00000000-0000-4000-8000-00000000f612', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f602', null, 2, '2048-02-01 12:00+00', '2048-02-08 12:00+00', 'pending', '2 Normalized Street', '16000', 'Angouleme', null, 130.00, 'not_started', 'outcome-normalized-review');

insert into public.reservation_items (id, organisation_id, reservation_id, product_id, unit_rental_price, line_total)
values
 ('00000000-0000-4000-8000-00000000f621', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f611', 'essential', 59.00, 59.00),
 ('00000000-0000-4000-8000-00000000f622', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f611', 'essential', 59.00, 59.00),
 ('00000000-0000-4000-8000-00000000f623', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f612', 'essential', 59.00, 59.00),
 ('00000000-0000-4000-8000-00000000f624', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f612', 'essential', 59.00, 59.00);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E3A-NORMAL-1', 'essential', 'P3E3A-NORMAL-1', 'available', true),
       ('P3E3A-NORMAL-2', 'essential', 'P3E3A-NORMAL-2', 'available', true),
       ('P3E3A-BROKEN-1', 'essential', 'P3E3A-BROKEN-1', 'available', true),
       ('P3E3A-BROKEN-2', 'essential', 'P3E3A-BROKEN-2', 'available', true);

insert into public.allocations (
 id, reservation_id, reservation_item_id, machine_id, status, operational_start, operational_end, hold_expires_at
)
values
 ('00000000-0000-4000-8000-00000000f631', '00000000-0000-4000-8000-00000000f611', '00000000-0000-4000-8000-00000000f621', 'P3E3A-NORMAL-1', 'held', '2048-01-01 05:30+00', '2048-01-08 21:30+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f632', '00000000-0000-4000-8000-00000000f611', '00000000-0000-4000-8000-00000000f622', 'P3E3A-NORMAL-2', 'held', '2048-01-01 05:30+00', '2048-01-08 21:30+00', now() + interval '1 hour'),
 ('00000000-0000-4000-8000-00000000f633', '00000000-0000-4000-8000-00000000f612', '00000000-0000-4000-8000-00000000f623', 'P3E3A-BROKEN-1', 'held', '2048-02-01 05:30+00', '2048-02-08 21:30+00', now() + interval '1 hour');

insert into public.service_jobs (
 id, reservation_id, job_type, scheduled_date, time_slot, address_line_1, postcode, city, status
)
values
 ('00000000-0000-4000-8000-00000000f641', '00000000-0000-4000-8000-00000000f611', 'delivery', '2048-01-01', '0830-1030', '1 Normalized Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f642', '00000000-0000-4000-8000-00000000f611', 'collection', '2048-01-08', '1630-1830', '1 Normalized Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f643', '00000000-0000-4000-8000-00000000f612', 'delivery', '2048-02-01', '0830-1030', '2 Normalized Street', '16000', 'Angouleme', 'scheduled'),
 ('00000000-0000-4000-8000-00000000f644', '00000000-0000-4000-8000-00000000f612', 'collection', '2048-02-08', '1630-1830', '2 Normalized Street', '16000', 'Angouleme', 'scheduled');

insert into public.payment_attempts (
 id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
 idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
values
 ('00000000-0000-4000-8000-00000000f651', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f611', 'stripe', 'rental', 130.00, 'EUR', 'checkout_open', 'outcome-normalized-paid', 'cs_p3e3a_npaid', 'pi_p3e3a_npaid'),
 ('00000000-0000-4000-8000-00000000f652', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000f612', 'stripe', 'rental', 130.00, 'EUR', 'checkout_open', 'outcome-normalized-review', 'cs_p3e3a_nreview', 'pi_p3e3a_nreview');

select * from public.receive_payment_provider_event('stripe', 'evt_p3e3a_npaid', 'checkout.session.completed', to_timestamp(1800000003), false,
 '4444444444444444444444444444444444444444444444444444444444444444');
select * from public.receive_payment_provider_event('stripe', 'evt_p3e3a_nreview', 'checkout.session.completed', to_timestamp(1800000004), false,
 '5555555555555555555555555555555555555555555555555555555555555555');
select * from public.match_payment_provider_event('evt_p3e3a_npaid', 'cs_p3e3a_npaid', 13000, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_npaid',
 '00000000-0000-4000-8000-00000000f651', '00000000-0000-4000-8000-00000000f651', '00000000-0000-4000-8000-00000000f611', false);
select * from public.match_payment_provider_event('evt_p3e3a_nreview', 'cs_p3e3a_nreview', 13000, 'eur', 'payment', 'complete', 'paid', 'pi_p3e3a_nreview',
 '00000000-0000-4000-8000-00000000f652', '00000000-0000-4000-8000-00000000f652', '00000000-0000-4000-8000-00000000f612', false);

select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_npaid'))),
          'paid_confirmed', 'complete normalized basket confirms after provider proof');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f611' and status = 'reserved' and hold_expires_at is null), 2,
          'normalized success transitions every linked allocation and clears every expiry');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f611' and event_type = 'reservation.confirmed'), 1,
          'normalized success emits one reservation-level confirmation');
select is((select outcome from public.apply_provider_payment_outcome((select id from public.payment_provider_events where provider_event_id = 'evt_p3e3a_nreview'))),
          'requires_review', 'incomplete normalized expected set routes proven payment to review');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f612'), 'pending',
          'malformed normalized basket leaves lifecycle pending');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f612'), 'requires_review',
          'malformed normalized basket records review status');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f612' and status = 'held'), 1,
          'malformed basket review does not mutate the extant held allocation');
select ok((select hold_expires_at > now() from public.allocations where id = '00000000-0000-4000-8000-00000000f633'),
          'malformed basket review does not clear or extend the hold expiry');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f612' and event_type = 'reservation.confirmed'), 0,
          'malformed basket review emits no confirmation event');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_p3e3a_nreview'), 'processed',
          'malformed but proven payment event is durably processed');

select * from finish();
rollback;

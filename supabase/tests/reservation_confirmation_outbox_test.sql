begin;

select plan(34);

select ok(has_function_privilege('service_role', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'service_role can confirm reservations');
select ok(not has_function_privilege('public', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'PUBLIC cannot confirm reservations');
select ok(not has_function_privilege('anon', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'anon cannot confirm reservations');
select ok(not has_function_privilege('authenticated', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'authenticated cannot confirm reservations');
select ok(has_table_privilege('service_role', 'public.outbox_events', 'INSERT'), 'service_role can insert outbox events');
select ok(not has_table_privilege('anon', 'public.outbox_events', 'INSERT'), 'anon cannot insert outbox events');
select ok((select relrowsecurity from pg_class where oid = 'public.outbox_events'::regclass), 'outbox RLS remains enabled');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('CONFIRM-EVENT-MACHINE', 'essential', 'CONFIRM-EVENT-SERIAL', 'available', true);

create temporary table confirmed_fixture as
select * from public.create_reservation_transaction(
    'Event', 'Confirmation', 'event-confirmation@example.com', '0600000701', 'essential',
    '2038-01-10 12:00:00+00', '2038-01-13 12:00:00+00', '1 Rue Event', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2038-01-10',
    '0830-1030', '2038-01-13', '1630-1830', 'confirmation-event-001',
    '2038-01-10 06:30:00', '2038-01-13 22:30:00'
);

select * from public.confirm_reservation((select reservation_id from confirmed_fixture));
select is((select status from public.reservations where id = (select reservation_id from confirmed_fixture)), 'confirmed', 'reservation becomes confirmed');
select is((select status from public.allocations where id = (select allocation_id from confirmed_fixture)), 'reserved', 'held allocation becomes reserved');
select ok((select hold_expires_at is null from public.allocations where id = (select allocation_id from confirmed_fixture)), 'confirmation clears hold expiry');
select is((select machine_id from public.allocations where id = (select allocation_id from confirmed_fixture)), 'CONFIRM-EVENT-MACHINE', 'machine assignment is preserved');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 1, 'one confirmation event is created');
select is((select organisation_id from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), (select organisation_id from public.reservations where id = (select reservation_id from confirmed_fixture)), 'event organisation matches reservation');
select is((select event_type from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 'reservation.confirmed', 'event type is reservation.confirmed');
select is((select aggregate_type from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 'reservation', 'event aggregate type is reservation');
select is((select aggregate_id from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), (select reservation_id from confirmed_fixture), 'event aggregate id matches reservation');
select is((select payload from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), '{}'::jsonb, 'event payload is empty');
select is((select status from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 'pending', 'event starts pending');
select is((select attempt_count from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 0, 'event starts with zero attempts');
select ok((select claim_token is null and lease_expires_at is null and processed_at is null from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 'new event has no claim or processing timestamps');

select lives_ok($$ select * from public.confirm_reservation((select reservation_id from confirmed_fixture)) $$, 'repeated confirmation remains idempotent');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 1, 'repeated confirmation does not duplicate the event');

delete from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture);
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 0, 'repair fixture has no confirmation event');
select lives_ok($$ select * from public.confirm_reservation((select reservation_id from confirmed_fixture)) $$, 'confirmed retry can repair a missing event');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from confirmed_fixture)), 1, 'confirmed retry creates the missing event once');

select throws_ok($$ select * from public.confirm_reservation('00000000-0000-4000-8000-000000009901'::uuid) $$, 'P0002', null, 'missing reservation is rejected');
select is((select count(*)::integer from public.outbox_events where event_type = 'reservation.confirmed' and aggregate_id = '00000000-0000-4000-8000-000000009901'::uuid), 0, 'missing reservation creates no event');

create temporary table invalid_fixture as
select * from public.create_reservation_transaction(
    'Event', 'Invalid', 'event-invalid@example.com', '0600000702', 'essential',
    '2038-02-10 12:00:00+00', '2038-02-13 12:00:00+00', '2 Rue Event', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2038-02-10',
    '0830-1030', '2038-02-13', '1630-1830', 'confirmation-event-002',
    '2038-02-10 06:30:00', '2038-02-13 22:30:00'
);
update public.allocations set hold_expires_at = now() - interval '1 minute' where id = (select allocation_id from invalid_fixture);
select throws_ok($$ select * from public.confirm_reservation((select reservation_id from invalid_fixture)) $$, 'P0001', null, 'expired hold is rejected');
select is((select status from public.reservations where id = (select reservation_id from invalid_fixture)), 'pending', 'failed confirmation leaves reservation pending');
select is((select status from public.allocations where id = (select allocation_id from invalid_fixture)), 'held', 'failed confirmation leaves allocation held');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from invalid_fixture)), 0, 'failed confirmation creates no event');

create temporary table cancelled_fixture as
select * from public.create_reservation_transaction(
    'Event', 'Cancelled', 'event-cancelled@example.com', '0600000703', 'essential',
    '2038-03-10 12:00:00+00', '2038-03-13 12:00:00+00', '3 Rue Event', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2038-03-10',
    '0830-1030', '2038-03-13', '1630-1830', 'confirmation-event-003',
    '2038-03-10 06:30:00', '2038-03-13 22:30:00'
);
update public.reservations set status = 'cancelled' where id = (select reservation_id from cancelled_fixture);
select throws_ok($$ select * from public.confirm_reservation((select reservation_id from cancelled_fixture)) $$, 'P0001', null, 'invalid reservation state is rejected');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from cancelled_fixture)), 0, 'invalid state creates no event');

select throws_ok($$ insert into public.outbox_events (organisation_id, event_type, aggregate_type, aggregate_id) values ((select organisation_id from public.reservations where id = (select reservation_id from confirmed_fixture)), 'reservation.confirmed', 'reservation', (select reservation_id from confirmed_fixture)) $$, '23505', null, 'logical event uniqueness safeguard remains enforced');

select * from finish();
rollback;

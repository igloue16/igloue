begin;

select plan(22);

select ok(has_function_privilege('service_role', 'public.cancel_reservation(uuid)', 'EXECUTE'), 'service_role can cancel reservations');
select ok(not has_function_privilege('anon', 'public.cancel_reservation(uuid)', 'EXECUTE'), 'anon cannot cancel reservations');
select ok(not has_function_privilege('authenticated', 'public.cancel_reservation(uuid)', 'EXECUTE'), 'authenticated cannot cancel reservations');
select ok(not has_function_privilege('public', 'public.cancel_reservation(uuid)', 'EXECUTE'), 'PUBLIC cannot cancel reservations');
select ok((select relrowsecurity from pg_class where oid = 'public.reservations'::regclass), 'reservation RLS remains enabled');
select ok(exists (select 1 from pg_constraint where conname = 'allocations_no_machine_overlap'), 'allocation exclusion constraint remains present');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('CANCEL-MACHINE-1', 'essential', 'CANCEL-SERIAL-1', 'available', true);

create temporary table cancel_first as
select * from public.create_reservation_transaction(
    'Cancel', 'Pending', 'cancel-pending@example.com', '0600000011', 'essential',
    '2027-04-10 12:00:00+00', '2027-04-13 12:00:00+00', '11 Rue Cancel', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-04-10',
    '0830-1030', '2027-04-13', '1630-1830', 'cancel-pending-001',
    '2027-04-10 06:30:00', '2027-04-13 22:30:00'
);

create temporary table cancel_result as
select * from public.cancel_reservation((select reservation_id from cancel_first));

create temporary table cancel_after as
select a.released_at
from public.allocations a
join public.reservations r on r.id = a.reservation_id
where r.idempotency_key = 'cancel-pending-001';

select is((select reservation_status from cancel_result), 'cancelled', 'pending reservation becomes cancelled');
select is((select a.status from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'cancel-pending-001'), 'released', 'blocking allocation becomes released');
select ok((select a.released_at is not null from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'cancel-pending-001'), 'released_at is set');
select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'cancel-pending-001' and j.status = 'cancelled'), 2, 'scheduled service jobs become cancelled');
select is((select status from public.physical_machines where id = 'CANCEL-MACHINE-1'), 'available', 'physical machine status is unchanged');

select lives_ok($$ select * from public.cancel_reservation((select reservation_id from cancel_first)) $$, 'duplicate cancellation is idempotent');
select is((select a.released_at from public.allocations a join public.reservations r on r.id = a.reservation_id where r.idempotency_key = 'cancel-pending-001'), (select released_at from cancel_after), 'duplicate cancellation does not rewrite released_at');

create temporary table cancel_reuse as
select * from public.create_reservation_transaction(
    'Cancel', 'Reuse', 'cancel-reuse@example.com', '0600000012', 'essential',
    '2027-04-10 12:00:00+00', '2027-04-13 12:00:00+00', '11 Rue Cancel', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-04-10',
    '0830-1030', '2027-04-13', '1630-1830', 'cancel-reuse-001',
    '2027-04-10 06:30:00', '2027-04-13 22:30:00'
);
select is((select machine_id from cancel_reuse), 'CANCEL-MACHINE-1', 'released machine can be reused for the same period');

create temporary table cancel_confirmed as
select * from public.create_reservation_transaction(
    'Cancel', 'Confirmed', 'cancel-confirmed@example.com', '0600000013', 'essential',
    '2027-05-10 12:00:00+00', '2027-05-13 12:00:00+00', '11 Rue Cancel', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-05-10',
    '0830-1030', '2027-05-13', '1630-1830', 'cancel-confirmed-001',
    '2027-05-10 06:30:00', '2027-05-13 22:30:00'
);
update public.reservations set status = 'confirmed' where id = (select reservation_id from cancel_confirmed);
select is((select reservation_status from public.cancel_reservation((select reservation_id from cancel_confirmed))), 'cancelled', 'confirmed reservation becomes cancelled');

update public.service_jobs j set status = case when j.job_type = 'delivery' then 'completed' else 'failed' end
from public.reservations r
where r.id = j.reservation_id and r.idempotency_key = 'cancel-confirmed-001';
select is((select count(*)::integer from public.service_jobs j join public.reservations r on r.id = j.reservation_id where r.idempotency_key = 'cancel-confirmed-001' and j.status in ('completed','failed')), 2, 'completed and failed jobs remain historical');

create temporary table cancel_progress as
select * from public.create_reservation_transaction(
    'Cancel', 'Progress', 'cancel-progress@example.com', '0600000014', 'essential',
    '2027-06-10 12:00:00+00', '2027-06-13 12:00:00+00', '11 Rue Cancel', null,
    '16000', 'Angouleme', 'local', 59, 29, 19, 250, 73.29, '2027-06-10',
    '0830-1030', '2027-06-13', '1630-1830', 'cancel-progress-001',
    '2027-06-10 06:30:00', '2027-06-13 22:30:00'
);
update public.service_jobs j set status = 'in_progress'
from public.reservations r
where r.id = j.reservation_id and r.idempotency_key = 'cancel-progress-001' and j.job_type = 'delivery';
select throws_ok($$ select * from public.cancel_reservation((select reservation_id from cancel_progress)) $$, 'P0001', null, 'in-progress service job rejects cancellation');
select is((select status from public.reservations where id = (select reservation_id from cancel_progress)), 'pending', 'rejected cancellation leaves reservation unchanged');
select is((select status from public.allocations a where a.reservation_id = (select reservation_id from cancel_progress)), 'held', 'rejected cancellation leaves allocation blocking');
select is((select status from public.service_jobs j where j.reservation_id = (select reservation_id from cancel_progress) and j.job_type = 'delivery'), 'in_progress', 'in-progress job remains unchanged');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-0000-0000-000000000711', (select id from public.organisations where slug = 'igloue'), 'Cancel', 'Ongoing', 'cancel-ongoing@example.com');
insert into public.reservations (id, organisation_id, customer_id, product_id, rental_start, rental_end, delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking, deposit_amount, total_amount, status)
values ('00000000-0000-0000-0000-000000000711', (select id from public.organisations where slug = 'igloue'), '00000000-0000-0000-0000-000000000711', 'essential', '2027-07-01 10:00:00+00', '2027-07-04 10:00:00+00', '11 Rue Cancel', '16000', 'Angouleme', 59, 250, 59, 'ongoing');
select throws_ok($$ select * from public.cancel_reservation('00000000-0000-0000-0000-000000000711') $$, 'P0001', null, 'ongoing reservation rejects cancellation');

select throws_ok($$ select * from public.cancel_reservation('00000000-0000-0000-0000-000000009999') $$, 'P0002', null, 'missing reservation fails clearly');

select * from finish();

rollback;

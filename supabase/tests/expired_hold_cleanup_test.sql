begin;

select plan(27);

select ok(has_function_privilege('service_role', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'service_role can run expired-hold cleanup');
select ok(not has_function_privilege('public', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'PUBLIC cannot run expired-hold cleanup');
select ok(not has_function_privilege('anon', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'anon cannot run expired-hold cleanup');
select ok(not has_function_privilege('authenticated', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'authenticated cannot run expired-hold cleanup');
select ok(exists (select 1 from pg_constraint where conname = 'allocations_no_machine_overlap'), 'allocation exclusion constraint remains intact');
select ok(not has_table_privilege('anon', 'public.allocations', 'SELECT'), 'browser roles retain private allocation access');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('CLEAN-MACHINE-1', 'essential', 'CLEAN-SERIAL-1', 'available', true);

create temporary table cleanup_expired as
select * from public.create_reservation_transaction(
    'Cleanup', 'Expired', 'cleanup-expired@example.com', '0600000201', 'essential',
    '2036-01-10 12:00:00+00', '2036-01-13 12:00:00+00', '1 Rue Cleanup', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2036-01-10',
    '0830-1030', '2036-01-13', '1630-1830', 'cleanup-expired-001',
    '2036-01-10 06:30:00', '2036-01-13 22:30:00'
);
update public.allocations set hold_expires_at = now() - interval '1 minute' where id = (select allocation_id from cleanup_expired);
select is(public.cleanup_expired_reservation_holds(100), 1, 'expired pending hold is processed');
select is((select status from public.reservations where id = (select reservation_id from cleanup_expired)), 'cancelled', 'expired reservation becomes cancelled');
select is((select status from public.allocations where id = (select allocation_id from cleanup_expired)), 'released', 'expired allocation becomes released');
select ok((select released_at is not null from public.allocations where id = (select allocation_id from cleanup_expired)), 'released_at is populated');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from cleanup_expired) and status = 'cancelled'), 2, 'scheduled service jobs are cancelled');
select is((select available_count from public.check_product_machine_availability('essential', '2036-01-10 12:00+00', '2036-01-13 12:00+00')), 1, 'released machine is available again');

create temporary table cleanup_pending as
select * from public.create_reservation_transaction(
    'Cleanup', 'Pending', 'cleanup-pending@example.com', '0600000202', 'essential',
    '2036-02-10 12:00:00+00', '2036-02-13 12:00:00+00', '2 Rue Cleanup', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2036-02-10',
    '0830-1030', '2036-02-13', '1630-1830', 'cleanup-pending-001',
    '2036-02-10 06:30:00', '2036-02-13 22:30:00'
);
select is(public.cleanup_expired_reservation_holds(100), 0, 'non-expired hold is not processed');
select is((select status from public.reservations where id = (select reservation_id from cleanup_pending)), 'pending', 'non-expired reservation remains pending');
update public.allocations set hold_expires_at = null where id = (select allocation_id from cleanup_pending);
select is(public.cleanup_expired_reservation_holds(100), 0, 'null expiry is not treated as expired');
select is((select status from public.allocations where id = (select allocation_id from cleanup_pending)), 'held', 'null-expiry allocation remains held');

create temporary table cleanup_confirmed as
select * from public.create_reservation_transaction(
    'Cleanup', 'Confirmed', 'cleanup-confirmed@example.com', '0600000203', 'essential',
    '2036-03-10 12:00:00+00', '2036-03-13 12:00:00+00', '3 Rue Cleanup', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2036-03-10',
    '0830-1030', '2036-03-13', '1630-1830', 'cleanup-confirmed-001',
    '2036-03-10 06:30:00', '2036-03-13 22:30:00'
);
select * from public.confirm_reservation((select reservation_id from cleanup_confirmed));
update public.allocations set hold_expires_at = now() - interval '1 minute' where id = (select allocation_id from cleanup_confirmed);
select is(public.cleanup_expired_reservation_holds(100), 0, 'confirmed reservation is never expired');
select is((select status from public.allocations where id = (select allocation_id from cleanup_confirmed)), 'reserved', 'reserved allocation remains reserved');

create temporary table cleanup_active as
select * from public.create_reservation_transaction(
    'Cleanup', 'Active', 'cleanup-active@example.com', '0600000204', 'essential',
    '2036-04-10 12:00:00+00', '2036-04-13 12:00:00+00', '4 Rue Cleanup', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2036-04-10',
    '0830-1030', '2036-04-13', '1630-1830', 'cleanup-active-001',
    '2036-04-10 06:30:00', '2036-04-13 22:30:00'
);
update public.allocations
set status = 'active', hold_expires_at = now() - interval '1 minute'
where id = (select allocation_id from cleanup_active);
select is(public.cleanup_expired_reservation_holds(100), 0, 'active allocation is never processed');
select is((select status from public.allocations where id = (select allocation_id from cleanup_active)), 'active', 'active allocation remains active');

create temporary table cleanup_history as
select * from public.create_reservation_transaction(
    'Cleanup', 'History', 'cleanup-history@example.com', '0600000205', 'essential',
    '2036-05-10 12:00:00+00', '2036-05-13 12:00:00+00', '5 Rue Cleanup', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2036-05-10',
    '0830-1030', '2036-05-13', '1630-1830', 'cleanup-history-001',
    '2036-05-10 06:30:00', '2036-05-13 22:30:00'
);
update public.service_jobs
set status = case when job_type = 'delivery' then 'completed' else 'failed' end
where reservation_id = (select reservation_id from cleanup_history);
update public.allocations
set hold_expires_at = now() - interval '1 minute'
where id = (select allocation_id from cleanup_history);
select is(public.cleanup_expired_reservation_holds(100), 1, 'expired reservation with historical jobs is processed');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from cleanup_history) and status = 'completed'), 1, 'completed service job remains completed');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from cleanup_history) and status = 'failed'), 1, 'failed service job remains failed');

create temporary table cleanup_release_snapshot as
select released_at from public.allocations where id = (select allocation_id from cleanup_expired);
select is(public.cleanup_expired_reservation_holds(100), 0, 'repeated cleanup is idempotent');
select is((select released_at from public.allocations where id = (select allocation_id from cleanup_expired)), (select released_at from cleanup_release_snapshot), 'repeated cleanup does not rewrite released_at');
select throws_ok($$ select public.cleanup_expired_reservation_holds(0) $$, '22023', null, 'invalid cleanup limit is rejected');
select ok(exists (select 1 from pg_class where relname = 'allocations' and relrowsecurity), 'allocation RLS remains enabled');
select * from finish();
rollback;

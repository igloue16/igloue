begin;

select plan(40);

select ok(to_regclass('public.allocations') is not null, 'allocations table exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allocations' and column_name = 'hold_expires_at' and data_type = 'timestamp with time zone'), 'hold_expires_at is timestamptz');
select ok(has_function_privilege('service_role', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'service_role can confirm reservations');
select ok(not has_function_privilege('anon', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'anon cannot confirm reservations');
select ok(not has_function_privilege('authenticated', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'authenticated cannot confirm reservations');
select ok(not has_function_privilege('public', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'PUBLIC cannot confirm reservations');
select ok(has_function_privilege('service_role', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'service_role can expire holds');
select ok(not has_function_privilege('anon', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'anon cannot expire holds');
select ok(not has_function_privilege('authenticated', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'authenticated cannot expire holds');
select ok(not has_function_privilege('public', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'PUBLIC cannot expire holds');
select ok(exists (select 1 from pg_constraint where conname = 'allocations_no_machine_overlap'), 'allocation exclusion constraint remains present');
select ok((select relrowsecurity from pg_class where oid = 'public.allocations'::regclass), 'allocation RLS remains unchanged');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('LIFE-MACHINE-1', 'essential', 'LIFE-SERIAL-1', 'available', true);

create temporary table lifecycle_first as
select * from public.create_reservation_transaction(
    'Lifecycle', 'Retry', 'lifecycle-retry@example.com', '0600000101', 'essential',
    '2032-01-10 12:00:00+00', '2032-01-13 12:00:00+00', '1 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-01-10',
    '0830-1030', '2032-01-13', '1630-1830', 'lifecycle-retry-001',
    '2032-01-10 06:30:00', '2032-01-13 22:30:00'
);

select is((select status from public.reservations r where r.id = (select reservation_id from lifecycle_first)), 'pending', 'new reservation is pending');
select is((select status from public.allocations a where a.id = (select allocation_id from lifecycle_first)), 'held', 'new allocation is held');
select ok((select hold_expires_at is not null from public.allocations where id = (select allocation_id from lifecycle_first)), 'new hold has an expiry');
select ok((select hold_expires_at between created_at + interval '29 minutes' and created_at + interval '31 minutes' from public.allocations where id = (select allocation_id from lifecycle_first)), 'hold expiry is approximately 30 minutes');

create temporary table lifecycle_retry as
select * from public.create_reservation_transaction(
    'Changed', 'Retry', 'changed@example.com', '0600000102', 'essential',
    '2032-01-10 12:00:00+00', '2032-01-13 12:00:00+00', '1 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-01-10',
    '0830-1030', '2032-01-13', '1630-1830', 'lifecycle-retry-001',
    '2032-01-10 06:30:00', '2032-01-13 22:30:00'
);

select is((select customer_id from lifecycle_retry), (select customer_id from lifecycle_first), 'retry returns same customer');
select is((select allocation_id from lifecycle_retry), (select allocation_id from lifecycle_first), 'retry returns same allocation');
select is((select count(*)::integer from public.customers where email in ('lifecycle-retry@example.com', 'changed@example.com')), 1, 'retry does not create another customer');
select ok((select hold_expires_at = (select hold_expires_at from public.allocations where id = (select allocation_id from lifecycle_first)) from public.allocations where id = (select allocation_id from lifecycle_retry)), 'retry does not extend hold expiry');

create temporary table lifecycle_confirm as
select * from public.confirm_reservation((select reservation_id from lifecycle_first));
select is((select reservation_status from lifecycle_confirm), 'confirmed', 'pending reservation confirms');
select is((select status from public.reservations where id = (select reservation_id from lifecycle_first)), 'confirmed', 'reservation status is confirmed');
select is((select status from public.allocations where id = (select allocation_id from lifecycle_first)), 'reserved', 'held allocation becomes reserved');
select is((select machine_id from public.allocations where id = (select allocation_id from lifecycle_first)), 'LIFE-MACHINE-1', 'machine assignment is preserved');
select ok((select hold_expires_at is null from public.allocations where id = (select allocation_id from lifecycle_first)), 'confirmed allocation expiry is cleared');
select lives_ok($$ select * from public.confirm_reservation((select reservation_id from lifecycle_first)) $$, 'confirmation is idempotent');

create temporary table lifecycle_expired as
select * from public.create_reservation_transaction(
    'Lifecycle', 'Expired', 'lifecycle-expired@example.com', '0600000103', 'essential',
    '2032-02-10 12:00:00+00', '2032-02-13 12:00:00+00', '2 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-02-10',
    '0830-1030', '2032-02-13', '1630-1830', 'lifecycle-expired-001',
    '2032-02-10 06:30:00', '2032-02-13 22:30:00'
);
update public.allocations set hold_expires_at = now() - interval '1 minute' where id = (select allocation_id from lifecycle_expired);
select throws_ok($$ select * from public.confirm_reservation((select reservation_id from lifecycle_expired)) $$, 'P0001', null, 'expired hold cannot be confirmed');
select is((select status from public.reservations where id = (select reservation_id from lifecycle_expired)), 'pending', 'expired confirmation leaves reservation pending');
select is((select status from public.allocations where id = (select allocation_id from lifecycle_expired)), 'held', 'expired confirmation leaves allocation held');
select * from public.expire_reservation_hold((select reservation_id from lifecycle_expired));
select is((select status from public.reservations where id = (select reservation_id from lifecycle_expired)), 'cancelled', 'expired reservation is cancelled');
select is((select status from public.allocations where id = (select allocation_id from lifecycle_expired)), 'released', 'expired allocation is released');
select ok((select released_at is not null from public.allocations where id = (select allocation_id from lifecycle_expired)), 'expiry sets released_at');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from lifecycle_expired) and status = 'cancelled'), 2, 'expiry cancels scheduled service jobs');
select lives_ok($$ select * from public.expire_reservation_hold((select reservation_id from lifecycle_expired)) $$, 'duplicate expiry is idempotent');

create temporary table lifecycle_reuse as
select * from public.create_reservation_transaction(
    'Lifecycle', 'Reuse', 'lifecycle-reuse@example.com', '0600000104', 'essential',
    '2032-02-10 12:00:00+00', '2032-02-13 12:00:00+00', '2 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-02-10',
    '0830-1030', '2032-02-13', '1630-1830', 'lifecycle-reuse-001',
    '2032-02-10 06:30:00', '2032-02-13 22:30:00'
);
select is((select machine_id from lifecycle_reuse), 'LIFE-MACHINE-1', 'released machine can be reused');

create temporary table lifecycle_early as
select * from public.create_reservation_transaction(
    'Lifecycle', 'Early', 'lifecycle-early@example.com', '0600000105', 'essential',
    '2032-03-10 12:00:00+00', '2032-03-13 12:00:00+00', '3 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-03-10',
    '0830-1030', '2032-03-13', '1630-1830', 'lifecycle-early-001',
    '2032-03-10 06:30:00', '2032-03-13 22:30:00'
);
select throws_ok($$ select * from public.expire_reservation_hold((select reservation_id from lifecycle_early)) $$, 'P0001', null, 'unexpired hold cannot be expired');
select is((select status from public.reservations where id = (select reservation_id from lifecycle_early)), 'pending', 'early expiry leaves reservation pending');

select throws_ok($$ select * from public.expire_reservation_hold((select reservation_id from lifecycle_first)) $$, 'P0001', null, 'confirmed reservation cannot expire');
select is((select status from public.allocations where id = (select allocation_id from lifecycle_first)), 'reserved', 'confirmed allocation remains reserved');

create temporary table lifecycle_history as
select * from public.create_reservation_transaction(
    'Lifecycle', 'History', 'lifecycle-history@example.com', '0600000106', 'essential',
    '2032-04-10 12:00:00+00', '2032-04-13 12:00:00+00', '4 Rue Lifecycle', null,
    '16000', 'Angouleme', 'local', 59, 29, 0, 250, 88, '2032-04-10',
    '0830-1030', '2032-04-13', '1630-1830', 'lifecycle-history-001',
    '2032-04-10 06:30:00', '2032-04-13 22:30:00'
);
update public.service_jobs j
set status = case when j.job_type = 'delivery' then 'completed' else 'failed' end
where j.reservation_id = (select reservation_id from lifecycle_history);
update public.allocations set hold_expires_at = now() - interval '1 minute' where id = (select allocation_id from lifecycle_history);
select * from public.expire_reservation_hold((select reservation_id from lifecycle_history));
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from lifecycle_history) and status in ('completed', 'failed')), 2, 'completed and failed jobs remain historical');

select * from finish();
rollback;

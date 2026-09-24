begin;

select plan(22);

select ok(
    exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'create_reservation_with_payment_capability'
          and pronargs = 39
    ),
    'normalized reservation creation overload exists'
);
select ok(
    exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'create_reservation_with_payment_capability'
          and pronargs = 39
          and not prosecdef
    ),
    'normalized reservation creation is SECURITY INVOKER'
);
select ok(
    exists (
        select 1 from pg_proc as f
        where pronamespace = 'public'::regnamespace
          and proname = 'create_reservation_with_payment_capability'
          and pronargs = 39
          and proconfig @> array['search_path=""']
    ),
    'normalized reservation creation clears search_path'
);

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('MM2-TEST-001', 'essential', 'MM2-TEST-SERIAL-001', 'available', true);

create temporary table mm2_first as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('a', 64),
    'MM2', 'Customer', 'mm2@example.test', '0612345678',
    'essential', '2037-01-01 12:00:00+00', '2037-01-08 12:00:00+00',
    '1 MM2 Street', null, '16000', 'Angouleme', 'local',
    59, 29, 0, 250, 88,
    '2037-01-01', '0830-1030', '2037-01-08', '1630-1830',
    'mm2-normalized-creation-1', '2037-01-01 06:30:00', '2037-01-08 22:30:00',
    'Recipient', 'Snapshot', '0612345678',
    'business', 'Snapshot Recipient', 'MM2 Company', 'billing@example.test',
    '2 Billing Street', 'Suite 2', '75001', 'Paris', 'FR',
    59, 59
);

select is((select created_new from mm2_first), true, 'first normalized request creates a reservation');
select is((select capability_hash from public.reservation_payment_capabilities where reservation_id = (select reservation_id from mm2_first)), chr(92) || 'x' || repeat('a', 64), 'capability is stored canonically without a bridge prefix');
select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 1, 'one reservation item snapshot is created');
select is((select product_id from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 'essential', 'item product is persisted');
select is((select unit_rental_price from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 59::numeric, 'unit rental price is authoritative');
select is((select line_total from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 59::numeric, 'line total is authoritative');
select is((select recipient_first_name from public.reservations where id = (select reservation_id from mm2_first)), 'Recipient', 'recipient first name is snapshotted');
select is((select recipient_last_name from public.reservations where id = (select reservation_id from mm2_first)), 'Snapshot', 'recipient last name is snapshotted');
select is((select billing_mode from public.reservation_billing_details where reservation_id = (select reservation_id from mm2_first)), 'business', 'billing mode is snapshotted');
select is((select company_name from public.reservation_billing_details where reservation_id = (select reservation_id from mm2_first)), 'MM2 Company', 'billing company is snapshotted');
select is((select billing_address_line_2 from public.reservation_billing_details where reservation_id = (select reservation_id from mm2_first)), 'Suite 2', 'optional billing address line is snapshotted');
select is((select count(*)::integer from public.reservation_billing_details where reservation_id = (select reservation_id from mm2_first)), 1, 'one billing snapshot is created');
select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 1, 'item snapshot count is stable');

create temporary table mm2_replay as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('a', 64),
    'MM2', 'Customer', 'mm2@example.test', '0612345678',
    'essential', '2037-01-01 12:00:00+00', '2037-01-08 12:00:00+00',
    '1 MM2 Street', null, '16000', 'Angouleme', 'local',
    59, 29, 0, 250, 88,
    '2037-01-01', '0830-1030', '2037-01-08', '1630-1830',
    'mm2-normalized-creation-1', '2037-01-01 06:30:00', '2037-01-08 22:30:00',
    'Recipient', 'Snapshot', '0612345678',
    'business', 'Snapshot Recipient', 'MM2 Company', 'billing@example.test',
    '2 Billing Street', 'Suite 2', '75001', 'Paris', 'FR',
    59, 59
);

select is((select created_new from mm2_replay), false, 'idempotent replay does not create a second reservation');
select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm2_first)), 1, 'idempotent replay does not duplicate item snapshot');
select is((select count(*)::integer from public.reservation_billing_details where reservation_id = (select reservation_id from mm2_first)), 1, 'idempotent replay does not duplicate billing snapshot');

select throws_ok($$
    select * from public.create_reservation_with_payment_capability(
        chr(92) || 'x' || repeat('a', 64), 'MM2', 'Customer', 'mm2@example.test', '0612345678',
        'essential', '2037-01-01 12:00:00+00', '2037-01-08 12:00:00+00',
        '1 MM2 Street', null, '16000', 'Angouleme', 'local',
        1, 29, 0, 250, 30, '2037-01-01', '0830-1030', '2037-01-08', '1630-1830',
        'mm2-invalid-price', '2037-01-01 06:30:00', '2037-01-08 22:30:00',
        'Recipient', 'Snapshot', '0612345678', 'personal', 'Snapshot Recipient', null,
        'billing@example.test', '2 Billing Street', null, '75001', 'Paris', 'FR', 1, 1
    )
$$, '22023', null, 'authoritative pricing mismatch is rejected');

select ok(
    exists (
        select 1 from pg_proc as f
        where f.pronamespace = 'public'::regnamespace
          and f.proname = 'create_reservation_with_payment_capability'
          and f.pronargs = 39
          and has_function_privilege('service_role', f.oid, 'EXECUTE')
          and not has_function_privilege('anon', f.oid, 'EXECUTE')
    ),
    'normalized creation overload is service_role-only'
);

select ok(
    not exists (
        select 1 from public.reservations r
        join public.reservation_items i on i.reservation_id = r.id
        where r.id = (select reservation_id from mm2_first)
          and r.payment_status = 'paid'
    ),
    'normalized creation does not mark payment paid'
);

select * from finish();
rollback;

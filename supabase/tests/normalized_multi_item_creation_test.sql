begin;

select plan(39);

select ok(
    exists (
        select 1
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'create_reservation_with_payment_capability'
          and pronargs = 40
    ),
    'normalized multi-item reservation RPC exists'
);
select ok(
    exists (
        select 1
        from pg_proc as f
        where f.pronamespace = 'public'::regnamespace
          and f.proname = 'create_reservation_with_payment_capability'
          and f.pronargs = 40
          and has_function_privilege('service_role', f.oid, 'EXECUTE')
          and not has_function_privilege('anon', f.oid, 'EXECUTE')
    ),
    'normalized multi-item RPC is service-role-only'
);

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3c-product-a', 'MM3C Product A', 59.00, 250.00, true),
    ('mm3c-product-b', 'MM3C Product B', 79.00, 350.00, true),
    ('mm3c-product-c', 'MM3C Product C', 89.00, 450.00, true),
    ('mm3c-product-d', 'MM3C Product D', 99.00, 550.00, true),
    ('mm3c-product-e', 'MM3C Product E', 109.00, 650.00, true);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3c-machine-a1', 'mm3c-product-a', 'available', true),
    ('mm3c-machine-a2', 'mm3c-product-a', 'available', true),
    ('mm3c-machine-b1', 'mm3c-product-b', 'available', true),
    ('mm3c-machine-b2', 'mm3c-product-b', 'available', true),
    ('mm3c-machine-c1', 'mm3c-product-c', 'available', true),
    ('mm3c-machine-c2', 'mm3c-product-c', 'available', true),
    ('mm3c-machine-d1', 'mm3c-product-d', 'available', true);

create temporary table mm3c_single as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('a', 64),
    'MM3C', 'Single', 'mm3c-single@example.test', '0612345678',
    'mm3c-product-a', '2045-01-01 12:00:00+00', '2045-01-08 12:00:00+00',
    '1 MM3C Street', null, '16000', 'Angouleme', 'local',
    59, 29, 0, 250, 88,
    '2045-01-01', '0830-1030', '2045-01-08', '1630-1830',
    'mm3c-single-1', '2045-01-01 06:30:00', '2045-01-08 22:30:00',
    'Single', 'Recipient', '0612345678', 'personal', 'Single Recipient', null,
    'mm3c-single@example.test', '1 MM3C Street', null, '16000', 'Angouleme', 'FR',
    59, 59, '[{"product_id":"mm3c-product-a","quantity":1}]'::jsonb
);

select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3c_single)), 1, 'single item creates one reservation item');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3c_single) and status = 'held'), 1, 'single item creates one held allocation');
select is((select product_id from public.reservation_items where reservation_id = (select reservation_id from mm3c_single)), 'mm3c-product-a', 'single item product is authoritative');
select is((select deposit_amount from public.reservations where id = (select reservation_id from mm3c_single)), 250.00::numeric, 'single item deposit remains numeric');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from mm3c_single)), 2, 'single item creates one delivery and collection job');
select is((select count(*)::integer from public.reservation_payment_capabilities where reservation_id = (select reservation_id from mm3c_single)), 1, 'single item creates one payment capability');
select is((select recipient_first_name from public.reservations where id = (select reservation_id from mm3c_single)), 'Single', 'single item recipient snapshot is preserved');
select is((select count(*)::integer from public.reservation_billing_details where reservation_id = (select reservation_id from mm3c_single)), 1, 'single item billing snapshot is preserved');

create temporary table mm3c_same_product as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3C', 'Same', 'mm3c-same@example.test', '0612345678',
    'mm3c-product-b', '2045-02-01 12:00:00+00', '2045-02-08 12:00:00+00',
    '2 MM3C Street', null, '16000', 'Angouleme', 'local',
    79, 29, 0, null, 187,
    '2045-02-01', '0830-1030', '2045-02-08', '1630-1830',
    'mm3c-same-2', '2045-02-01 06:30:00', '2045-02-08 22:30:00',
    'Same', 'Recipient', '0612345678', 'business', 'Same Company', 'same@example.test',
    'same@example.test', '2 MM3C Street', null, '16000', 'Angouleme', 'FR',
    null, null, '[{"product_id":"mm3c-product-b","quantity":2}]'::jsonb
);

select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3c_same_product)), 2, 'same-product quantity two creates two item rows');
select is((select count(distinct machine_id)::integer from public.allocations where reservation_id = (select reservation_id from mm3c_same_product) and status = 'held'), 2, 'same-product quantity two uses distinct machines');
select is((select count(*)::integer from public.allocations a join public.reservation_items ri on ri.id = a.reservation_item_id where a.reservation_id = (select reservation_id from mm3c_same_product) and a.status = 'held'), 2, 'each same-product item has one linked allocation');
select is((select count(distinct hold_expires_at)::integer from public.allocations where reservation_id = (select reservation_id from mm3c_same_product) and status = 'held'), 1, 'same-product hold expiry is shared');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from mm3c_same_product)), 2, 'same-product quantity two still creates one job pair');
select is((select deposit_amount from public.reservations where id = (select reservation_id from mm3c_same_product)), null::numeric, 'same-product multi-item deposit is NULL');
select is((select status from public.reservations where id = (select reservation_id from mm3c_same_product)), 'pending', 'same-product reservation remains pending');

create temporary table mm3c_mixed as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('c', 64),
    'MM3C', 'Mixed', 'mm3c-mixed@example.test', '0612345678',
    null, '2045-03-01 12:00:00+00', '2045-03-08 12:00:00+00',
    '3 MM3C Street', null, '16000', 'Angouleme', 'local',
    null, 29, 0, null, 167,
    '2045-03-01', '0830-1030', '2045-03-08', '1630-1830',
    'mm3c-mixed-3', '2045-03-01 06:30:00', '2045-03-08 22:30:00',
    'Mixed', 'Recipient', '0612345678', 'personal', 'Mixed Recipient', null,
    'mm3c-mixed@example.test', '3 MM3C Street', null, '16000', 'Angouleme', 'FR',
    null, null,
    '[{"product_id":"mm3c-product-a","quantity":1},{"product_id":"mm3c-product-b","quantity":1}]'::jsonb
);

select is((select product_id from public.reservations where id = (select reservation_id from mm3c_mixed)), null::text, 'mixed reservation does not fabricate a legacy product');
select is((select weekly_price_at_booking from public.reservations where id = (select reservation_id from mm3c_mixed)), null::numeric, 'mixed reservation does not fabricate a legacy weekly price');
select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3c_mixed)), 2, 'mixed basket creates two item rows');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3c_mixed) and status = 'held'), 2, 'mixed basket creates two held allocations');
select is((select count(*)::integer from public.allocations a join public.reservation_items ri on ri.id = a.reservation_item_id join public.physical_machines pm on pm.id = a.machine_id where a.reservation_id = (select reservation_id from mm3c_mixed) and a.status = 'held' and pm.product_id = ri.product_id), 2, 'mixed allocations match exact item products');
select is((select deposit_amount from public.reservations where id = (select reservation_id from mm3c_mixed)), null::numeric, 'mixed basket deposit is NULL without aggregation');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from mm3c_mixed)), 0, 'creation emits no confirmation outbox event');

select lives_ok($$
    select * from public.initiate_reservation_payment(
        (select reservation_id from mm3c_mixed),
        chr(92) || 'x' || repeat('c', 64),
        'mm3c-mixed-payment'
    )
$$, 'multi-item reservation is eligible for payment initiation');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3c_mixed)), 1,
          'multi-item payment initiation creates one reservation attempt');

select throws_ok($$
    select * from public.create_reservation_with_payment_capability(
        chr(92) || 'x' || repeat('d', 64),
        'MM3C', 'Shortage', 'mm3c-shortage@example.test', '0612345678',
        'mm3c-product-c', '2045-04-01 12:00:00+00', '2045-04-08 12:00:00+00',
        '4 MM3C Street', null, '16000', 'Angouleme', 'local',
        89, 29, 0, null, 296,
        '2045-04-01', '0830-1030', '2045-04-08', '1630-1830',
        'mm3c-shortage-4', '2045-04-01 06:30:00', '2045-04-08 22:30:00',
        'Shortage', 'Recipient', '0612345678', 'personal', 'Shortage Recipient', null,
        'mm3c-shortage@example.test', '4 MM3C Street', null, '16000', 'Angouleme', 'FR',
        null, null, '[{"product_id":"mm3c-product-c","quantity":3}]'::jsonb
    )
$$, 'P0001', null, 'same-product shortage fails atomically');
select is((select count(*)::integer from public.customers where email = 'mm3c-shortage@example.test'), 0, 'shortage rolls back customer');
select is((select count(*)::integer from public.reservations where idempotency_key = 'mm3c-shortage-4'), 0, 'shortage rolls back reservation');
select is((select count(*)::integer from public.reservation_items where reservation_id in (select id from public.reservations where idempotency_key = 'mm3c-shortage-4')), 0, 'shortage rolls back items');

select throws_ok($$
    select * from public.create_reservation_with_payment_capability(
        chr(92) || 'x' || repeat('e', 64),
        'MM3C', 'Mixed Shortage', 'mm3c-mixed-shortage@example.test', '0612345678',
        null, '2045-05-01 12:00:00+00', '2045-05-08 12:00:00+00',
        '5 MM3C Street', null, '16000', 'Angouleme', 'local',
        null, 29, 0, null, 237,
        '2045-05-01', '0830-1030', '2045-05-08', '1630-1830',
        'mm3c-mixed-shortage-5', '2045-05-01 06:30:00', '2045-05-08 22:30:00',
        'Mixed Shortage', 'Recipient', '0612345678', 'personal', 'Mixed Shortage Recipient', null,
        'mm3c-mixed-shortage@example.test', '5 MM3C Street', null, '16000', 'Angouleme', 'FR',
        null, null,
        '[{"product_id":"mm3c-product-d","quantity":1},{"product_id":"mm3c-product-e","quantity":1}]'::jsonb
    )
$$, 'P0001', null, 'mixed shortage fails atomically');
select is((select count(*)::integer from public.customers where email = 'mm3c-mixed-shortage@example.test'), 0, 'mixed shortage rolls back customer');
select is((select count(*)::integer from public.reservations where idempotency_key = 'mm3c-mixed-shortage-5'), 0, 'mixed shortage rolls back reservation');
select is((select count(*)::integer from public.allocations where reservation_id in (select id from public.reservations where idempotency_key = 'mm3c-mixed-shortage-5')), 0, 'mixed shortage rolls back allocations');

create temporary table mm3c_same_replay as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3C', 'Same', 'mm3c-same@example.test', '0612345678',
    'mm3c-product-b', '2045-02-01 12:00:00+00', '2045-02-08 12:00:00+00',
    '2 MM3C Street', null, '16000', 'Angouleme', 'local',
    79, 29, 0, null, 187,
    '2045-02-01', '0830-1030', '2045-02-08', '1630-1830',
    'mm3c-same-2', '2045-02-01 06:30:00', '2045-02-08 22:30:00',
    'Same', 'Recipient', '0612345678', 'business', 'Same Company', 'same@example.test',
    'same@example.test', '2 MM3C Street', null, '16000', 'Angouleme', 'FR',
    null, null, '[{"product_id":"mm3c-product-b","quantity":2}]'::jsonb
);

select is((select created_new from mm3c_same_replay), false, 'same normalized multi-item request replays');
select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3c_same_product)), 2, 'replay does not duplicate items');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3c_same_product)), 2, 'replay does not duplicate allocations');
select is((select count(*)::integer from public.service_jobs where reservation_id = (select reservation_id from mm3c_same_product)), 2, 'replay does not duplicate jobs');
select is((select count(*)::integer from public.reservation_payment_capabilities where reservation_id = (select reservation_id from mm3c_same_product)), 1, 'replay does not duplicate capability');

select * from finish();
rollback;

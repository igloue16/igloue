begin;

select plan(26);

select ok(
    to_regprocedure('public.allocate_reservation_items(uuid,timestamptz,timestamptz)') is not null,
    'MM3B allocator exists'
);
select ok(
    (select prosecdef = false
     from pg_proc
     where oid = 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)'::regprocedure),
    'allocator is SECURITY INVOKER'
);
select ok(
    not has_function_privilege('public', 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.allocate_reservation_items(uuid,timestamptz,timestamptz)', 'EXECUTE'),
    'allocator is service_role-only'
);
select ok(
    exists (select 1 from pg_indexes where indexname = 'allocations_reservation_status_id_idx')
    and exists (select 1 from pg_indexes where indexname = 'physical_machines_allocator_candidates_idx'),
    'allocator indexes exist'
);

insert into public.organisations (id, slug, name)
values ('00000000-0000-0000-0000-00000000a301', 'mm3b-org', 'MM3B Organisation');

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3b-product-a', 'MM3B Product A', 59.00, 250.00, true),
    ('mm3b-product-b', 'MM3B Product B', 79.00, 350.00, true),
    ('mm3b-product-off', 'MM3B Inactive Product', 89.00, 400.00, false);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-0000-0000-00000000a302',
        '00000000-0000-0000-0000-00000000a301',
        'MM3B', 'Customer', 'mm3b@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, quantity,
    rental_start, rental_end, delivery_address_line_1,
    delivery_postcode, delivery_city, weekly_price_at_booking,
    deposit_amount, total_amount
)
values
    ('00000000-0000-0000-0000-00000000a303', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 59.00),
    ('00000000-0000-0000-0000-00000000a304', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 2,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 118.00),
    ('00000000-0000-0000-0000-00000000a305', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 2,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 118.00),
    ('00000000-0000-0000-0000-00000000a306', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 2,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 118.00),
    ('00000000-0000-0000-0000-00000000a307', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 59.00),
    ('00000000-0000-0000-0000-00000000a308', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 59.00),
    ('00000000-0000-0000-0000-00000000a309', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-a', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 59.00, 250.00, 59.00),
    ('00000000-0000-0000-0000-00000000a30a', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-b', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 79.00, 350.00, 79.00),
    ('00000000-0000-0000-0000-00000000a30b', '00000000-0000-0000-0000-00000000a301',
     '00000000-0000-0000-0000-00000000a302', 'mm3b-product-off', 1,
     '2038-01-01 10:00:00+00', '2038-01-08 10:00:00+00',
     '1 MM3B Street', '16000', 'Angouleme', 89.00, 400.00, 89.00);

insert into public.reservation_items (
    id, organisation_id, reservation_id, product_id, unit_rental_price, line_total
)
values
    ('00000000-0000-0000-0000-00000000a401', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a303', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a402', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a304', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a403', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a304', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a404', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a305', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a405', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a305', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a406', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a306', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a407', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a306', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a408', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a307', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a409', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a308', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a40a', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a309', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a40b', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a30a', 'mm3b-product-b', 79, 79),
    ('00000000-0000-0000-0000-00000000a40d', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a30a', 'mm3b-product-a', 59, 59),
    ('00000000-0000-0000-0000-00000000a40c', '00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-00000000a30b', 'mm3b-product-off', 89, 89);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3b-machine-01', 'mm3b-product-a', 'available', true),
    ('mm3b-machine-02', 'mm3b-product-a', 'available', true),
    ('mm3b-machine-03', 'mm3b-product-a', 'available', true),
    ('mm3b-machine-04', 'mm3b-product-a', 'available', true),
    ('mm3b-machine-05', 'mm3b-product-a', 'available', true),
    ('mm3b-machine-b', 'mm3b-product-b', 'available', true),
    ('mm3b-machine-off', 'mm3b-product-a', 'available', false),
    ('mm3b-machine-unavailable', 'mm3b-product-a', 'available', true);

update public.physical_machines
set unavailable_until = '2038-01-09 00:00:00+00'
where id = 'mm3b-machine-unavailable';

create temporary table mm3b_first as
select * from public.allocate_reservation_items(
    '00000000-0000-0000-0000-00000000a303',
    '2038-01-01 08:00:00+00',
    '2038-01-08 12:00:00+00'
);

select is((select count(*)::integer from mm3b_first), 1, 'single item allocates one machine');
select is((select count(*)::integer from mm3b_first where reservation_item_id is not null), 1, 'single allocation links item');
select is((select machine_id from mm3b_first), 'mm3b-machine-01', 'machine selection is deterministic');
select is((select hold_expires_at from mm3b_first), (select min(hold_expires_at) from mm3b_first), 'single hold expiry is populated');
select is((select status from public.allocations where id = (select allocation_id from mm3b_first)), 'held', 'single allocation is held');

create temporary table mm3b_same_product as
select * from public.allocate_reservation_items(
    '00000000-0000-0000-0000-00000000a304',
    '2038-01-01 08:00:00+00',
    '2038-01-08 12:00:00+00'
);

select is((select count(*)::integer from mm3b_same_product), 2, 'two same-product items allocate two machines');
select is((select count(distinct machine_id)::integer from mm3b_same_product), 2, 'same-product machines are distinct');
select is((select count(distinct hold_expires_at)::integer from mm3b_same_product), 1, 'same-product hold expiry is shared');
select ok((select bool_and(machine_id in ('mm3b-machine-02', 'mm3b-machine-03')) from mm3b_same_product), 'same-product selection is deterministic');

create temporary table mm3b_mixed as
select * from public.allocate_reservation_items(
    '00000000-0000-0000-0000-00000000a30a',
    '2038-01-01 08:00:00+00',
    '2038-01-08 12:00:00+00'
);

select is((select count(*)::integer from mm3b_mixed), 2, 'mixed product fixture allocates both items');
select is((select count(*)::integer from mm3b_mixed where machine_id = 'mm3b-machine-b'), 1, 'product B machine matches requested product');
select is((select count(*)::integer from mm3b_mixed where machine_id = 'mm3b-machine-04'), 1, 'product A machine matches requested product');

select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a305',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'three items with insufficient machines fail');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-0000-0000-00000000a305' and status in ('held', 'reserved', 'active')), 0, 'same-product shortage leaves no allocations');

select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a306',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'four items with insufficient machines fail');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-0000-0000-00000000a306'), 0, 'shortage rolls back all allocations');

select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a30b',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'inactive product fails');

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-0000-0000-00000000a307', 'mm3b-machine-04', 'held', '2038-02-01 08:00:00+00', '2038-02-08 12:00:00+00');
select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a307',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'existing held allocation fails closed');

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-0000-0000-00000000a308', 'mm3b-machine-05', 'reserved', '2038-02-01 08:00:00+00', '2038-02-08 12:00:00+00');
select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a308',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'existing reserved allocation fails closed');

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-0000-0000-00000000a309', 'mm3b-machine-01', 'active', '2038-02-01 08:00:00+00', '2038-02-08 12:00:00+00');
select throws_ok($$
    select * from public.allocate_reservation_items(
        '00000000-0000-0000-0000-00000000a309',
        '2038-01-01 08:00:00+00',
        '2038-01-08 12:00:00+00'
    )
$$, 'P0001', null, 'existing active allocation fails closed');

select lives_ok($$
    insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
    values ('00000000-0000-0000-0000-00000000a30b', 'mm3b-machine-01', 'released', '2038-01-01 08:00:00+00', '2038-01-08 12:00:00+00')
$$, 'historical released allocation remains supported');

select ok(
    not exists (
        select 1 from pg_proc
        where proname = 'allocate_reservation_items' and prosecdef
    ),
    'allocator has no SECURITY DEFINER variant'
);

select * from finish();

rollback;

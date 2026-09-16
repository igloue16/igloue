begin;

select plan(2);

-- Create the minimum data needed for an allocation test.
insert into public.products (
    id,
    name,
    weekly_price,
    deposit_amount
)
values (
    'test-product',
    'Test Air Conditioner',
    59.00,
    250.00
);

insert into public.physical_machines (
    id,
    product_id,
    status
)
values (
    'S03',
    'test-product',
    'available'
);

insert into public.customers (
    id,
    organisation_id,
    first_name,
    last_name,
    email
)
values (
    '00000000-0000-0000-0000-000000000001',
    (select id from public.organisations where slug = 'igloue'),
    'Test',
    'Customer',
    'test@example.com'
);

insert into public.reservations (
    id,
    organisation_id,
    customer_id,
    product_id,
    quantity,
    rental_start,
    rental_end,
    delivery_address_line_1,
    delivery_postcode,
    delivery_city,
    weekly_price_at_booking,
    deposit_amount,
    total_amount
)
values
(
    '00000000-0000-0000-0000-000000000101',
    (select organisation_id from public.customers where id = '00000000-0000-0000-0000-000000000001'),
    '00000000-0000-0000-0000-000000000001',
    'test-product',
    1,
    '2026-07-01 10:00:00+02',
    '2026-07-07 10:00:00+02',
    '1 Test Street',
    '16000',
    'Angouleme',
    59.00,
    250.00,
    59.00
),
(
    '00000000-0000-0000-0000-000000000102',
    (select organisation_id from public.customers where id = '00000000-0000-0000-0000-000000000001'),
    '00000000-0000-0000-0000-000000000001',
    'test-product',
    1,
    '2026-07-05 10:00:00+02',
    '2026-07-10 10:00:00+02',
    '1 Test Street',
    '16000',
    'Angouleme',
    59.00,
    250.00,
    59.00
);

-- First reservation successfully blocks S03.
insert into public.allocations (
    reservation_id,
    machine_id,
    status,
    operational_start,
    operational_end
)
values (
    '00000000-0000-0000-0000-000000000101',
    'S03',
    'reserved',
    '2026-07-01 08:00:00+02',
    '2026-07-07 14:00:00+02'
);

select is(
    (select count(*)::integer
     from public.allocations
     where machine_id = 'S03'),
    1,
    'S03 has its first allocation'
);

-- This deliberately attempts to allocate S03 again during
-- an overlapping period. PostgreSQL should reject it.
select throws_ok(
    $$
        insert into public.allocations (
            reservation_id,
            machine_id,
            status,
            operational_start,
            operational_end
        )
        values (
            '00000000-0000-0000-0000-000000000102',
            'S03',
            'reserved',
            '2026-07-05 08:00:00+02',
            '2026-07-10 14:00:00+02'
        )
    $$,
    '23P01',
    null,
    'S03 cannot have overlapping blocking allocations'
);

select * from finish();

rollback;

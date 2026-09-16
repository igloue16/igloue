begin;

select plan(5);

-- Create two physical Essential machines for this test only.
insert into public.physical_machines (
    id,
    product_id,
    status,
    active
)
values
    ('TEST-E01', 'essential', 'available', true),
    ('TEST-E02', 'essential', 'available', true);

-- Create one test customer.
insert into public.customers (
    id,
    organisation_id,
    first_name,
    last_name,
    email
)
values (
    '00000000-0000-0000-0000-000000000010',
    (select id from public.organisations where slug = 'igloue'),
    'Machine',
    'Hold Test',
    'machine-hold-test@example.com'
);

-- Create three reservations for the same product and period.
insert into public.reservations (
    id,
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
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000010',
    'essential',
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
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000010',
    'essential',
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
    '00000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000010',
    'essential',
    1,
    '2026-07-01 10:00:00+02',
    '2026-07-07 10:00:00+02',
    '1 Test Street',
    '16000',
    'Angouleme',
    59.00,
    250.00,
    59.00
);

-- Reservation 201 should automatically hold the first machine.
select lives_ok(
    $$
        select *
        from public.create_machine_hold(
            '00000000-0000-0000-0000-000000000201',
            '2026-07-01 08:00:00+02',
            '2026-07-07 14:00:00+02'
        )
    $$,
    'first reservation can create a machine hold'
);

select is(
    (
        select count(*)::integer
        from public.allocations
        where reservation_id =
            '00000000-0000-0000-0000-000000000201'
          and status = 'held'
    ),
    1,
    'first reservation has exactly one held machine'
);

-- Retrying the same reservation should return its existing hold,
-- not allocate another machine.
select lives_ok(
    $$
        select *
        from public.create_machine_hold(
            '00000000-0000-0000-0000-000000000201',
            '2026-07-01 08:00:00+02',
            '2026-07-07 14:00:00+02'
        )
    $$,
    'retrying the same reservation reuses its hold'
);

select is(
    (
        select count(*)::integer
        from public.allocations
        where reservation_id =
            '00000000-0000-0000-0000-000000000201'
    ),
    1,
    'retry does not create a duplicate allocation'
);

-- Reservation 202 consumes the second available machine.
select *
from public.create_machine_hold(
    '00000000-0000-0000-0000-000000000202',
    '2026-07-01 08:00:00+02',
    '2026-07-07 14:00:00+02'
);

-- Both test machines are now occupied for this period.
-- Reservation 203 must fail cleanly.
select throws_ok(
    $$
        select *
        from public.create_machine_hold(
            '00000000-0000-0000-0000-000000000203',
            '2026-07-01 08:00:00+02',
            '2026-07-07 14:00:00+02'
        )
    $$,
    'P0001',
    'No eligible machine available',
    'third overlapping reservation is rejected when fleet is full'
);

select * from finish();

rollback;

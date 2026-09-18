begin;

select plan(18);

select ok(has_function_privilege(
    'service_role',
    'public.check_product_machine_availability(text,timestamp without time zone,timestamp without time zone)',
    'EXECUTE'
), 'service_role can execute the civil-time availability RPC');
select ok(not has_function_privilege(
    'public',
    'public.check_product_machine_availability(text,timestamp without time zone,timestamp without time zone)',
    'EXECUTE'
), 'PUBLIC cannot execute the civil-time availability RPC');
select ok(not has_function_privilege(
    'anon',
    'public.check_product_machine_availability(text,timestamp without time zone,timestamp without time zone)',
    'EXECUTE'
), 'anon cannot execute the civil-time availability RPC');
select ok(not has_function_privilege(
    'authenticated',
    'public.check_product_machine_availability(text,timestamp without time zone,timestamp without time zone)',
    'EXECUTE'
), 'authenticated cannot execute the civil-time availability RPC');
select ok((select relrowsecurity from pg_class where oid = 'public.physical_machines'::regclass), 'physical-machine RLS remains enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.allocations'::regclass), 'allocation RLS remains enabled');

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('B3B1-TZ-001', 'essential', 'B3B1-TZ-SERIAL-001', 'available', true);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-0000-0000-000000009901',
    (select id from public.organisations where slug = 'igloue'),
    'Operational',
    'Authority',
    'b3b1-time@example.com'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, deposit_amount, total_amount
)
values (
    '00000000-0000-0000-0000-000000009901',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000009901',
    'essential', '2027-07-12 12:00:00+00', '2027-07-19 12:00:00+00',
    '1 Rue Test', '16000', 'Angouleme', 59, 250, 59
);

set local timezone = 'UTC';
select is(
    (select operational_start from public.check_product_machine_availability(
        'essential', '2027-07-12 06:30', '2027-07-19 22:30'
    ) where product_id = 'essential'),
    '2027-07-12 04:30:00+00'::timestamptz,
    'summer civil start converts to Europe/Paris UTC+2'
);
select is(
    (select operational_end from public.check_product_machine_availability(
        'essential', '2027-07-12 06:30', '2027-07-19 22:30'
    ) where product_id = 'essential'),
    '2027-07-19 20:30:00+00'::timestamptz,
    'summer civil end converts to Europe/Paris UTC+2'
);
select is((select available_count from public.check_product_machine_availability(
    'essential', '2027-07-12 06:30', '2027-07-19 22:30'
)), 1, 'summer interval is available in UTC session');

set local timezone = 'America/Los_Angeles';
select is(
    (select operational_start from public.check_product_machine_availability(
        'essential', '2027-07-12 06:30', '2027-07-19 22:30'
    ) where product_id = 'essential'),
    '2027-07-12 04:30:00+00'::timestamptz,
    'summer civil start is session-timezone independent'
);
select is(
    (select operational_end from public.check_product_machine_availability(
        'essential', '2027-07-12 06:30', '2027-07-19 22:30'
    ) where product_id = 'essential'),
    '2027-07-19 20:30:00+00'::timestamptz,
    'summer civil end is session-timezone independent'
);
select is((select available_count from public.check_product_machine_availability(
    'essential', '2027-07-12 06:30', '2027-07-19 22:30'
)), 1, 'summer availability is session-timezone independent');

set local timezone = 'UTC';
select is(
    (select operational_start from public.check_product_machine_availability(
        'essential', '2027-01-11 06:30', '2027-01-18 22:30'
    ) where product_id = 'essential'),
    '2027-01-11 05:30:00+00'::timestamptz,
    'winter civil start converts to Europe/Paris UTC+1'
);
select is(
    (select operational_end from public.check_product_machine_availability(
        'essential', '2027-01-11 06:30', '2027-01-18 22:30'
    ) where product_id = 'essential'),
    '2027-01-18 21:30:00+00'::timestamptz,
    'winter civil end converts to Europe/Paris UTC+1'
);

set local timezone = 'Asia/Tokyo';
select is(
    (select operational_start from public.check_product_machine_availability(
        'essential', '2027-01-11 06:30', '2027-01-18 22:30'
    ) where product_id = 'essential'),
    '2027-01-11 05:30:00+00'::timestamptz,
    'winter civil start is session-timezone independent'
);
select is(
    (select operational_end from public.check_product_machine_availability(
        'essential', '2027-01-11 06:30', '2027-01-18 22:30'
    ) where product_id = 'essential'),
    '2027-01-18 21:30:00+00'::timestamptz,
    'winter civil end is session-timezone independent'
);

set local timezone = 'UTC';
insert into public.allocations (
    reservation_id, machine_id, status, operational_start, operational_end
)
values (
    '00000000-0000-0000-0000-000000009901',
    'B3B1-TZ-001',
    'reserved',
    '2027-07-12 04:30:00+00',
    '2027-07-19 20:30:00+00'
);
select is((select available_count from public.check_product_machine_availability(
    'essential', '2027-07-12 06:30', '2027-07-19 22:30'
)), 0, 'overlap uses the converted summer instant');

set local timezone = 'Europe/Paris';
select is((select available_count from public.check_product_machine_availability(
    'essential', '2027-07-12 06:30', '2027-07-19 22:30'
)), 0, 'overlap is session-timezone independent');

select * from finish();
rollback;

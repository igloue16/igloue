begin;

select plan(21);

select ok(has_function_privilege('service_role', 'public.check_product_machine_availability(text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'service_role can check machine availability');
select ok(not has_function_privilege('public', 'public.check_product_machine_availability(text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'PUBLIC cannot check machine availability');
select ok(not has_function_privilege('anon', 'public.check_product_machine_availability(text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'anon cannot check machine availability');
select ok(not has_function_privilege('authenticated', 'public.check_product_machine_availability(text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'authenticated cannot check machine availability');
select ok((select relrowsecurity from pg_class where oid = 'public.physical_machines'::regclass), 'fleet RLS remains enabled');
select ok(not has_table_privilege('anon', 'public.physical_machines', 'SELECT'), 'anon cannot inspect physical machines');
select ok(not has_table_privilege('anon', 'public.allocations', 'SELECT'), 'anon cannot inspect allocations');

insert into public.physical_machines (id, product_id, serial_number, status, active, unavailable_until)
values
    ('AVAIL-M1', 'essential', 'AVAIL-S1', 'available', true, null),
    ('AVAIL-M2', 'essential', 'AVAIL-S2', 'available', true, null),
    ('AVAIL-M3', 'essential', 'AVAIL-S3', 'available', true, null),
    ('AVAIL-M4', 'essential', 'AVAIL-S4', 'available', true, null),
    ('AVAIL-M5', 'essential', 'AVAIL-S5', 'available', true, null),
    ('AVAIL-M6', 'essential', 'AVAIL-S6', 'available', true, null),
    ('AVAIL-M7', 'essential', 'AVAIL-S7', 'available', true, null),
    ('AVAIL-INACTIVE', 'essential', 'AVAIL-S8', 'available', false, null),
    ('AVAIL-MAINT', 'essential', 'AVAIL-S9', 'maintenance', true, null),
    ('AVAIL-FUTURE', 'essential', 'AVAIL-S10', 'available', true, '2040-01-01'::timestamptz);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-0000-0000-000000008801', (select id from public.organisations where slug = 'igloue'), 'Availability', 'Test', 'availability@example.com');
insert into public.reservations (id, organisation_id, customer_id, product_id, rental_start, rental_end, delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking, deposit_amount, total_amount)
values ('00000000-0000-0000-0000-000000008801', (select id from public.organisations where slug = 'igloue'), '00000000-0000-0000-0000-000000008801', 'essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00', '1 Rue Test', '16000', 'Angouleme', 59, 250, 59);

select is((select available_count from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), 7, 'eligible machine is available and count excludes inactive/status/unavailable machines');
select is((select available from public.check_product_machine_availability('mobile-duo', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), false, 'product with no machines is unavailable');
select throws_ok($$ select * from public.check_product_machine_availability('not-a-product', '2035-01-10 10:00+00', '2035-01-13 10:00+00') $$, 'P0002', null, 'unknown product is rejected');
update public.products set active = false where id = 'essential';
select throws_ok($$ select * from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00') $$, 'P0001', null, 'inactive product is rejected');
update public.products set active = true where id = 'essential';

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values
    ('00000000-0000-0000-0000-000000008801', 'AVAIL-M1', 'held', '2035-01-09 10:00+00', '2035-01-14 10:00+00'),
    ('00000000-0000-0000-0000-000000008801', 'AVAIL-M2', 'reserved', '2035-01-09 10:00+00', '2035-01-14 10:00+00'),
    ('00000000-0000-0000-0000-000000008801', 'AVAIL-M3', 'active', '2035-01-09 10:00+00', '2035-01-14 10:00+00'),
    ('00000000-0000-0000-0000-000000008801', 'AVAIL-M4', 'released', '2035-01-09 10:00+00', '2035-01-14 10:00+00'),
    ('00000000-0000-0000-0000-000000008801', 'AVAIL-M5', 'cancelled', '2035-01-09 10:00+00', '2035-01-14 10:00+00');
select is((select available_count from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), 4, 'held reserved and active allocations block while released/cancelled do not');
select ok((select available = false and available_count = 4 from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')) is false, 'availability result includes boolean and count');
select is((select available_count from public.check_product_machine_availability('essential', '2035-01-14 10:00+00', '2035-01-15 10:00+00')), 7, 'exact half-open boundary does not conflict');
select ok((select hold_expires_at is null from public.allocations where machine_id = 'AVAIL-M1'), 'expired-hold test setup remains compatible with current booking authority');
update public.allocations set hold_expires_at = now() - interval '1 minute' where machine_id = 'AVAIL-M1';
select is((select available_count from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), 4, 'expired held allocation remains blocking for consistency with booking authority');

insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-0000-0000-000000008801', 'AVAIL-M6', 'reserved', '2035-02-01 10:00+00', '2035-02-05 10:00+00');
select is((select available_count from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), 4, 'non-overlapping future allocation does not block');
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end)
values ('00000000-0000-0000-0000-000000008801', 'AVAIL-M7', 'reserved', '2035-01-09 10:00+00', '2035-01-14 10:00+00');
select is((select available_count from public.check_product_machine_availability('essential', '2035-01-10 10:00+00', '2035-01-13 10:00+00')), 3, 'conflicting future allocation blocks');
select is((select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'check_product_machine_availability'), 0, 'result is not a table exposing machine identifiers');
select ok(exists (select 1 from pg_constraint where conname = 'allocations_no_machine_overlap'), 'atomic booking exclusion constraint remains intact');
select throws_ok($$ select * from public.check_product_machine_availability('essential', '2035-01-13 10:00+00', '2035-01-10 10:00+00') $$, '22007', null, 'invalid operational period is rejected');
select * from finish();
rollback;

begin;

select plan(17);

select ok(to_regclass('public.payment_attempts_one_active_rental_idx') is not null,
          'active payment-attempt uniqueness index exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'provider_checkout_url'),
          'Checkout URL column exists');
select ok(has_function_privilege('service_role', 'public.get_reservation_payment_checkout(uuid,uuid)', 'EXECUTE'),
          'service_role can read Checkout state');
select ok(has_function_privilege('service_role', 'public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)', 'EXECUTE'),
          'service_role can persist Checkout state');
select ok(not has_function_privilege('anon', 'public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)', 'EXECUTE'),
          'browser roles cannot persist Checkout state');
select ok(not has_function_privilege('authenticated', 'public.get_reservation_payment_checkout(uuid,uuid)', 'EXECUTE'),
          'browser roles cannot read Checkout state');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'checkout_idempotency_key'),
          'redundant Checkout idempotency key is not stored');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000d201', (select id from public.organisations where slug = 'igloue'), 'Checkout', 'Fixture', 'checkout@example.test');
insert into public.reservations (id, organisation_id, customer_id, product_id, rental_start, rental_end, delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking, total_amount, payment_status, idempotency_key)
values ('00000000-0000-4000-8000-00000000d101', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000d201', 'essential', now() + interval '10 days', now() + interval '17 days', '1 Checkout Street', '16000', 'Angouleme', 59, 75, 'not_started', 'checkout-fixture');
insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P2C-MACHINE-1', 'essential', 'P2C-SERIAL-1', 'available', true);
insert into public.allocations (id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
values ('00000000-0000-4000-8000-00000000d301', '00000000-0000-4000-8000-00000000d101', 'P2C-MACHINE-1', 'held', now() + interval '10 days', now() + interval '17 days', now() + interval '30 minutes');
insert into public.payment_attempts (id, organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key)
values ('00000000-0000-4000-8000-00000000d401', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000d101', 'stripe', 'rental', 75, 'EUR', 'created', 'checkout-fixture-attempt');

select * from public.persist_reservation_payment_checkout('00000000-0000-4000-8000-00000000d401', (select id from public.organisations where slug = 'igloue'), 'cs_test_d401', 'https://checkout.stripe.test/d401', null);
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000d401'), 'checkout_open', 'Checkout persistence opens the attempt');
select is((select provider_checkout_url from public.payment_attempts where id = '00000000-0000-4000-8000-00000000d401'), 'https://checkout.stripe.test/d401', 'Checkout URL is persisted');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000d101'), 'not_started', 'Checkout persistence does not change reservation payment status');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000d101'), 'pending', 'Checkout persistence does not confirm reservation');
select is((select status from public.allocations where id = '00000000-0000-4000-8000-00000000d301'), 'held', 'Checkout persistence does not mutate allocation');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000d101', 'stripe', 'rental', 75, 'EUR', 'created', 'checkout-fixture-duplicate')$$, '23505', null, 'second active attempt is rejected');
select throws_ok($$select * from public.persist_reservation_payment_checkout('00000000-0000-4000-8000-00000000d401', (select id from public.organisations where slug = 'igloue'), 'cs_other', 'https://checkout.stripe.test/other', null)$$, 'P0001', null, 'conflicting Checkout Session cannot overwrite existing state');
select throws_ok($$select * from public.persist_reservation_payment_checkout('00000000-0000-4000-8000-00000000d401', '00000000-0000-0000-0000-000000000002', 'cs_test_d401', 'https://checkout.stripe.test/d401', null)$$, 'P0002', null, 'wrong organisation cannot access Checkout state');
select ok((select eligible from public.get_reservation_payment_checkout('00000000-0000-4000-8000-00000000d401', (select id from public.organisations where slug = 'igloue'))), 'eligible Checkout state is reported');
update public.reservations
set payment_status = 'processing'
where id = '00000000-0000-4000-8000-00000000d101';
select is((select eligible from public.get_reservation_payment_checkout('00000000-0000-4000-8000-00000000d401', (select id from public.organisations where slug = 'igloue'))), false, 'processing payment status is Checkout-ineligible');

select * from finish();
rollback;

begin;

select plan(40);

select ok(to_regclass('public.payment_attempts') is not null, 'payment_attempts exists');
select ok(to_regclass('public.payment_provider_events') is not null, 'payment_provider_events exists');
select ok((select relrowsecurity from pg_class where oid = 'public.payment_attempts'::regclass), 'payment_attempts RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.payment_provider_events'::regclass), 'provider events RLS enabled');
select ok(
    has_table_privilege('service_role', 'public.payment_attempts', 'SELECT')
    and has_table_privilege('service_role', 'public.payment_attempts', 'INSERT')
    and has_table_privilege('service_role', 'public.payment_attempts', 'UPDATE')
    and not has_table_privilege('service_role', 'public.payment_attempts', 'DELETE')
    and has_table_privilege('service_role', 'public.payment_provider_events', 'SELECT')
    and has_table_privilege('service_role', 'public.payment_provider_events', 'INSERT')
    and has_table_privilege('service_role', 'public.payment_provider_events', 'UPDATE')
    and not has_table_privilege('service_role', 'public.payment_provider_events', 'DELETE'),
    'service_role has only trusted payment table privileges'
);
select ok(
    not has_table_privilege('public', 'public.payment_attempts', 'INSERT')
    and not has_table_privilege('anon', 'public.payment_attempts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.payment_attempts', 'INSERT')
    and not has_table_privilege('public', 'public.payment_provider_events', 'INSERT')
    and not has_table_privilege('anon', 'public.payment_provider_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.payment_provider_events', 'INSERT'),
    'browser roles cannot write payment tables'
);
select ok(
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'amount' and data_type = 'numeric')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'organisation_id' and is_nullable = 'NO')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'reservation_id' and data_type = 'uuid'),
    'payment attempt core columns are present'
);
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_provider_events' and column_name in ('raw_payload', 'card_number', 'customer_email')), 'provider events contain no raw payload or PII columns');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000a201', (select id from public.organisations where slug = 'igloue'), 'Payment', 'Fixture', 'payment-fixture@example.test');
insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000a101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000a201',
    'essential', now() + interval '10 days', now() + interval '17 days',
    '1 Test Street', '16000', 'Angouleme', 59.00, 59.00, 'not_started',
    'payment-foundation-reservation'
);

insert into public.payment_attempts (id, organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key)
values ('00000000-0000-4000-8000-00000000a001', (select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 99.00, 'EUR', 'created', 'payment-test-001');
select ok(true, 'valid rental Stripe EUR attempt inserts');

select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 1, 'EUR', 'created', 'payment-test-001')$$, '23505', null, 'duplicate payment idempotency is rejected');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a999', 'stripe', 'rental', 1, 'EUR', 'created', 'payment-test-002')$$, '23503', null, 'reservation FK is enforced');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 1, 'EUR', 'created', 'payment-test-003')$$, '23503', null, 'reservation organisation ownership is enforced');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'paypal', 'rental', 1, 'EUR', 'created', 'payment-test-004')$$, '23514', null, 'provider is restricted to Stripe');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'deposit', 1, 'EUR', 'created', 'payment-test-005')$$, '23514', null, 'purpose is restricted to rental');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 1, 'GBP', 'created', 'payment-test-006')$$, '23514', null, 'currency is restricted to EUR');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', -1, 'EUR', 'created', 'payment-test-007')$$, '23514', null, 'negative amount is rejected');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 1, 'EUR', 'created', ' ')$$, '23514', null, 'blank payment idempotency is rejected');

insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'failed', 'payment-test-008');
select ok(true, 'failed retry attempt is permitted');

insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, provider_checkout_session_id, provider_payment_intent_id)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'checkout_open', 'payment-test-009', 'cs_test_001', 'pi_test_001');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, provider_checkout_session_id) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'checkout_open', 'payment-test-010', 'cs_test_001')$$, '23505', null, 'duplicate Checkout Session ID is rejected');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, provider_payment_intent_id) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'checkout_open', 'payment-test-011', 'pi_test_001')$$, '23505', null, 'duplicate PaymentIntent ID is rejected');
insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'created', 'payment-test-012');
select ok(true, 'multiple attempts with null provider IDs are permitted');

insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, paid_at)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'paid', 'payment-test-013', now());
select ok(true, 'one paid rental attempt is allowed');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, paid_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'paid', 'payment-test-014', now())$$, '23505', null, 'second paid rental attempt is rejected');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'paid', 'payment-test-015')$$, '23514', null, 'paid requires paid_at');
select throws_ok($$insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, refunded_at) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'created', 'payment-test-016', now())$$, '23514', null, 'refunded_at requires refunded status');
insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, paid_at)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'requires_review', 'payment-test-017', now());
select ok(true, 'requires_review can retain paid_at');
insert into public.payment_attempts (organisation_id, reservation_id, provider, purpose, amount, currency, status, idempotency_key, paid_at, refunded_at)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a101', 'stripe', 'rental', 10, 'EUR', 'refunded', 'payment-test-018', now(), now());
select ok(true, 'refunded requires both timestamps');

select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000a101'), 'not_started', 'reservation payment status remains unchanged');
select ok((select pg_get_constraintdef(oid) like '%not_started%' from pg_constraint where conname = 'reservations_payment_status_check'), 'reservation payment status constraint exists');
select ok((select column_default like '%not_started%' from information_schema.columns where table_schema = 'public' and table_name = 'reservations' and column_name = 'payment_status'), 'reservation payment status default remains not_started');
select lives_ok($$update public.reservations set payment_status = 'processing' where id = '00000000-0000-4000-8000-00000000a101'; update public.reservations set payment_status = 'paid' where id = '00000000-0000-4000-8000-00000000a101'; update public.reservations set payment_status = 'failed' where id = '00000000-0000-4000-8000-00000000a101'; update public.reservations set payment_status = 'requires_review' where id = '00000000-0000-4000-8000-00000000a101'; update public.reservations set payment_status = 'refunded' where id = '00000000-0000-4000-8000-00000000a101'; update public.reservations set payment_status = 'not_started' where id = '00000000-0000-4000-8000-00000000a101'$$, 'all approved reservation payment statuses are accepted');
select throws_ok($$update public.reservations set payment_status = 'unknown' where id = '00000000-0000-4000-8000-00000000a101'$$, '23514', null, 'arbitrary reservation payment status is rejected');

insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type)
values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'stripe', 'evt_test_001', 'checkout.session.completed');
select ok(true, 'valid provider event inserts');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'stripe', 'evt_test_001', 'checkout.session.completed')$$, '23505', null, 'duplicate provider event ID is rejected');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'stripe', '', 'checkout.session.completed')$$, '23514', null, 'blank provider event ID is rejected');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type) values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000a001', 'stripe', 'evt_test_002', 'checkout.session.completed')$$, '23503', null, 'provider event organisation ownership is enforced');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'paypal', 'evt_test_003', 'checkout.session.completed')$$, '23514', null, 'provider event provider is restricted');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'stripe', 'evt_test_004', 'checkout.session.completed', 'unknown')$$, '23514', null, 'provider event status is restricted');
select throws_ok($$insert into public.payment_provider_events (organisation_id, payment_attempt_id, provider, provider_event_id, event_type, status) values ((select id from public.organisations where slug = 'igloue'), '00000000-0000-4000-8000-00000000a001', 'stripe', 'evt_test_005', 'checkout.session.completed', 'processed')$$, '23514', null, 'processed provider event requires processed_at');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_provider_events' and column_name = 'raw_webhook_payload'), 'raw webhook payload is not stored');

select * from finish();
rollback;

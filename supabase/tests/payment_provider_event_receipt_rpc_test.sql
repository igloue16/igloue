begin;

select plan(51);

select ok(to_regprocedure('public.receive_payment_provider_event(text,text,text,timestamptz,boolean,text)') is not null,
          'receipt RPC exists with the intended signature');
select ok(not has_function_privilege('public', 'public.receive_payment_provider_event(text,text,text,timestamptz,boolean,text)', 'EXECUTE'),
          'PUBLIC cannot execute receipt RPC');
select ok(not has_function_privilege('anon', 'public.receive_payment_provider_event(text,text,text,timestamptz,boolean,text)', 'EXECUTE'),
          'anon cannot execute receipt RPC');
select ok(not has_function_privilege('authenticated', 'public.receive_payment_provider_event(text,text,text,timestamptz,boolean,text)', 'EXECUTE'),
          'authenticated cannot execute receipt RPC');
select ok(has_function_privilege('service_role', 'public.receive_payment_provider_event(text,text,text,timestamptz,boolean,text)', 'EXECUTE'),
          'service_role can execute receipt RPC');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000f201',
        (select id from public.organisations where slug = 'igloue'),
        'RPC', 'Fixture', 'receipt-rpc@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000f101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000f201', 'essential',
    now() + interval '10 days', now() + interval '17 days',
    '1 Receipt RPC Street', '16000', 'Angouleme', 59.00, 59.00,
    'not_started', 'receipt-rpc-reservation'
);

insert into public.payment_attempts (
    id, organisation_id, reservation_id, provider, purpose,
    amount, currency, status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000f001',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000f101', 'stripe', 'rental',
    59.00, 'EUR', 'created', 'receipt-rpc-attempt'
);

create temporary table receipt_first as
select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_first', 'checkout.session.completed',
    to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select is((select outcome from receipt_first), 'recorded', 'first receipt is recorded');
select ok((select event_id is not null from receipt_first), 'first receipt returns an event ID');
select is((select count(*)::integer from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 1, 'first receipt creates exactly one row');
select ok((select organisation_id is null and payment_attempt_id is null from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'new receipt has no business relationships');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'received', 'new receipt status is received');
select is((select event_type from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'checkout.session.completed', 'event type is persisted');
select is((select provider_event_created_at from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), to_timestamp(1800000000), 'provider event timestamp is persisted');
select is((select livemode from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), false, 'livemode is persisted');
select is((select payload_sha256 from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'payload digest is persisted');
select ok((select conflict_detected_at is null and last_error_code is null from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'first receipt has no conflict marker');

create temporary table receipt_duplicate as
select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_first', 'checkout.session.completed',
    to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select is((select outcome from receipt_duplicate), 'duplicate', 'identical receipt is duplicate');
select is((select event_id from receipt_duplicate), (select event_id from receipt_first), 'duplicate returns the same event ID');
select is((select count(*)::integer from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 1, 'duplicate does not create a row');
select is((select payload_sha256 from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'duplicate does not change digest');
select is((select event_type from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'checkout.session.completed', 'duplicate does not change metadata');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'received', 'duplicate does not reset status');

update public.payment_provider_events
set status = 'processed', processed_at = now()
where provider_event_id = 'evt_rpc_first';
select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_first', 'different.metadata',
    to_timestamp(1900000000), true,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
select ok((select status = 'processed' and processed_at is not null and event_type = 'checkout.session.completed' and livemode = false
           from public.payment_provider_events where provider_event_id = 'evt_rpc_first'),
          'same digest preserves all original metadata and processed state');

create temporary table receipt_conflict as
select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_first', 'tampered.type',
    to_timestamp(1900000000), true,
    'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
);

select is((select outcome from receipt_conflict), 'conflict', 'different digest is conflict');
select is((select event_id from receipt_conflict), (select event_id from receipt_first), 'conflict returns the same event ID');
select is((select count(*)::integer from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 1, 'conflict does not create a row');
select is((select payload_sha256 from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'conflict preserves original digest');
select is((select event_type from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'checkout.session.completed', 'conflict preserves original metadata');
select is((select status from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'failed', 'conflict marks the receipt failed');
select is((select last_error_code from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'conflicting_payload_digest', 'conflict stores the standard error code');
select ok((select conflict_detected_at is not null from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 'conflict stores a detection timestamp');

select is((select outcome from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_first', 'another.type', to_timestamp(2000000000), true,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
)), 'conflict', 'repeated conflict remains conflict');
select is((select count(*)::integer from public.payment_provider_events where provider_event_id = 'evt_rpc_first'), 1, 'repeated conflict does not create a row');

insert into public.payment_provider_events (provider, provider_event_id, event_type)
values ('stripe', 'evt_rpc_legacy_null_digest', 'checkout.session.completed');
select is((select outcome from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_legacy_null_digest', 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)), 'conflict', 'legacy NULL digest fails closed as conflict');
select ok((select payload_sha256 is null and status = 'failed' and last_error_code = 'conflicting_payload_digest'
           from public.payment_provider_events where provider_event_id = 'evt_rpc_legacy_null_digest'),
          'legacy NULL digest remains NULL and is marked anomalous');
select is((select outcome from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_legacy_null_digest', 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)), 'conflict', 'legacy NULL digest is not treated as duplicate');

select throws_ok($$select * from public.receive_payment_provider_event(
    'paypal', 'evt_rpc_bad_provider', 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'unsupported provider is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', null, 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'NULL event ID is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', '', 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'empty event ID is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', repeat('x', 256), 'checkout.session.completed', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'oversized event ID is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_bad_type', '', to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'empty event type is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_bad_type_long', repeat('x', 256), to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'oversized event type is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_null_created', 'checkout.session.completed', null, false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'NULL provider timestamp is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_null_livemode', 'checkout.session.completed', to_timestamp(1800000000), null,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
)$$, '22023', null, 'NULL livemode is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_bad_digest', 'checkout.session.completed', to_timestamp(1800000000), false, 'abc'
)$$, '22023', null, 'malformed digest is rejected');
select throws_ok($$select * from public.receive_payment_provider_event(
    'stripe', 'evt_rpc_upper_digest', 'checkout.session.completed', to_timestamp(1800000000), false,
    'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'
)$$, '22023', null, 'uppercase digest is rejected');

select ok(to_regclass('public.payment_provider_events_provider_event_idx') is not null,
          'provider/event uniqueness boundary remains present');
select is((select status from public.reservations where id = '00000000-0000-4000-8000-00000000f101'), 'pending', 'receipt RPC does not mutate reservation status');
select is((select payment_status from public.reservations where id = '00000000-0000-4000-8000-00000000f101'), 'not_started', 'receipt RPC does not mutate payment status');
select is((select status from public.payment_attempts where id = '00000000-0000-4000-8000-00000000f001'), 'created', 'receipt RPC does not mutate payment attempt');
select is((select count(*)::integer from public.allocations where reservation_id = '00000000-0000-4000-8000-00000000f101'), 0, 'receipt RPC does not mutate allocations');
select is((select count(*)::integer from public.outbox_events where aggregate_id = '00000000-0000-4000-8000-00000000f101'), 0, 'receipt RPC does not create outbox events');

select * from finish();
rollback;

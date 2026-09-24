begin;

select plan(24);

select ok(to_regclass('public.payment_provider_events') is not null,
          'payment_provider_events still exists');
select ok((select is_nullable = 'YES' from information_schema.columns
           where table_schema = 'public' and table_name = 'payment_provider_events'
             and column_name = 'organisation_id'),
          'organisation_id is nullable');
select ok((select is_nullable = 'YES' from information_schema.columns
           where table_schema = 'public' and table_name = 'payment_provider_events'
             and column_name = 'payment_attempt_id'),
          'payment_attempt_id is nullable');
select ok((select count(*) = 5 from information_schema.columns
           where table_schema = 'public' and table_name = 'payment_provider_events'
             and column_name in ('provider_event_created_at', 'livemode', 'payload_sha256', 'conflict_detected_at', 'last_error_code')),
          'receipt metadata columns exist');
select ok(exists (select 1 from pg_constraint where conname = 'payment_provider_events_relationship_pair_check'),
          'relationship pair constraint exists');
select ok(exists (select 1 from pg_constraint where conname = 'payment_provider_events_payload_sha256_check'),
          'payload digest constraint exists');
select ok(exists (select 1 from pg_constraint where conname = 'payment_provider_events_last_error_code_check'),
          'last error code constraint exists');

insert into public.customers (id, organisation_id, first_name, last_name, email)
values ('00000000-0000-4000-8000-00000000e201',
        (select id from public.organisations where slug = 'igloue'),
        'Receipt', 'Fixture', 'receipt-fixture@example.test');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, rental_start, rental_end,
    delivery_address_line_1, delivery_postcode, delivery_city,
    weekly_price_at_booking, total_amount, payment_status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000e101',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000e201', 'essential',
    now() + interval '10 days', now() + interval '17 days',
    '1 Receipt Street', '16000', 'Angouleme', 59.00, 59.00,
    'not_started', 'receipt-schema-reservation'
);

insert into public.payment_attempts (
    id, organisation_id, reservation_id, provider, purpose,
    amount, currency, status, idempotency_key
)
values (
    '00000000-0000-4000-8000-00000000e001',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000e101', 'stripe', 'rental',
    59.00, 'EUR', 'created', 'receipt-schema-attempt'
);

insert into public.payment_provider_events (
    provider, provider_event_id, event_type
)
values ('stripe', 'evt_receipt_null_pair', 'checkout.session.completed');
select ok(true, 'both relationship fields NULL are accepted');

insert into public.payment_provider_events (
    organisation_id, payment_attempt_id, provider, provider_event_id, event_type
)
values (
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-4000-8000-00000000e001',
    'stripe', 'evt_receipt_populated_pair', 'checkout.session.completed'
);
select ok(true, 'both relationship fields populated are accepted');

select throws_ok($$insert into public.payment_provider_events (
    organisation_id, provider, provider_event_id, event_type
) values (
    (select id from public.organisations where slug = 'igloue'),
    'stripe', 'evt_receipt_org_only', 'checkout.session.completed'
)$$, '23514', null, 'organisation_id only is rejected');

select throws_ok($$insert into public.payment_provider_events (
    payment_attempt_id, provider, provider_event_id, event_type
) values (
    '00000000-0000-4000-8000-00000000e001',
    'stripe', 'evt_receipt_attempt_only', 'checkout.session.completed'
)$$, '23514', null, 'payment_attempt_id only is rejected');

select throws_ok($$insert into public.payment_provider_events (
    organisation_id, payment_attempt_id, provider, provider_event_id, event_type
) values (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-4000-8000-00000000e001',
    'stripe', 'evt_receipt_wrong_org', 'checkout.session.completed'
)$$, '23503', null, 'composite relationship FK remains enforced');

insert into public.payment_provider_events (
    provider, provider_event_id, event_type, provider_event_created_at,
    livemode, payload_sha256, conflict_detected_at, last_error_code
)
values (
    'stripe', 'evt_receipt_metadata', 'checkout.session.completed',
    to_timestamp(1800000000), false,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    now(), 'conflicting_payload_digest'
);
select ok(true, 'receipt metadata and conflict error code are accepted');

insert into public.payment_provider_events (
    provider, provider_event_id, event_type, livemode
)
values ('stripe', 'evt_receipt_livemode_true', 'checkout.session.completed', true);
select ok(true, 'livemode true is accepted');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type, payload_sha256
) values (
    'stripe', 'evt_receipt_short_digest', 'checkout.session.completed', 'abc'
)$$, '23514', null, 'short payload digest is rejected');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type, payload_sha256
) values (
    'stripe', 'evt_receipt_upper_digest', 'checkout.session.completed',
    'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'
)$$, '23514', null, 'uppercase payload digest is rejected');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type, payload_sha256
) values (
    'stripe', 'evt_receipt_nonhex_digest', 'checkout.session.completed',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg'
)$$, '23514', null, 'non-hex payload digest is rejected');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type, last_error_code
) values (
    'stripe', 'evt_receipt_bad_error_code', 'checkout.session.completed', 'Bad Code'
)$$, '23514', null, 'invalid error code is rejected');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type
) values ('paypal', 'evt_receipt_paypal', 'checkout.session.completed')$$,
    '23514', null, 'provider remains Stripe-only');

insert into public.payment_provider_events (provider, provider_event_id, event_type)
values ('stripe', 'evt_receipt_duplicate', 'checkout.session.completed');

select throws_ok($$insert into public.payment_provider_events (
    provider, provider_event_id, event_type
) values ('stripe', 'evt_receipt_duplicate', 'checkout.session.completed')$$,
    '23505', null, 'provider/event unique boundary remains enforced');

insert into public.payment_provider_events (provider, provider_event_id, event_type, status)
values ('stripe', 'evt_receipt_ignored', 'checkout.session.completed', 'ignored');
insert into public.payment_provider_events (provider, provider_event_id, event_type, status)
values ('stripe', 'evt_receipt_failed', 'checkout.session.completed', 'failed');
insert into public.payment_provider_events (provider, provider_event_id, event_type, status, processed_at)
values ('stripe', 'evt_receipt_processed', 'checkout.session.completed', 'processed', now());
select ok(true, 'existing status model remains received/processed/ignored/failed');

select ok(
    has_table_privilege('service_role', 'public.payment_provider_events', 'SELECT')
    and has_table_privilege('service_role', 'public.payment_provider_events', 'INSERT')
    and has_table_privilege('service_role', 'public.payment_provider_events', 'UPDATE')
    and not has_table_privilege('service_role', 'public.payment_provider_events', 'DELETE'),
    'service_role retains intended provider-event access'
);
select ok(
    not has_table_privilege('public', 'public.payment_provider_events', 'SELECT')
    and not has_table_privilege('anon', 'public.payment_provider_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_provider_events', 'SELECT')
    and not has_table_privilege('public', 'public.payment_provider_events', 'INSERT')
    and not has_table_privilege('anon', 'public.payment_provider_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.payment_provider_events', 'INSERT'),
    'browser roles remain denied provider-event access'
);
select ok(not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_provider_events'
      and column_name in (
          'raw_webhook_payload', 'raw_payload', 'stripe_signature',
          'webhook_secret', 'customer_email', 'card_number',
          'card_data', 'payment_method_data'
      )
), 'no raw payload, signature, secret, or customer/card columns exist');

select * from finish();
rollback;

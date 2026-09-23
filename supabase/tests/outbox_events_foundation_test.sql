begin;

select plan(22);

select ok(
    to_regclass('public.outbox_events') is not null,
    'outbox_events table exists'
);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'outbox_events'
          and column_name = 'id'
          and data_type = 'uuid'
          and column_default like '%gen_random_uuid%'
    )
    and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'outbox_events'
          and column_name = 'organisation_id'
          and data_type = 'uuid'
          and is_nullable = 'NO'
    )
    and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'outbox_events'
          and column_name = 'payload'
          and data_type = 'jsonb'
          and is_nullable = 'NO'
    ),
    'core outbox column types and defaults are present'
);

select ok(
    (
        select count(*)::integer
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'outbox_events'
          and column_name in (
              'event_type', 'aggregate_type', 'aggregate_id', 'status',
              'attempt_count', 'available_at', 'last_attempt_at',
              'processed_at', 'last_error_code', 'created_at'
          )
    ) = 10,
    'all event lifecycle columns exist'
);

select ok(
    exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.oid = 'public.outbox_events'::regclass
          and c.contype = 'f'
          and pg_get_constraintdef(c.oid) like '%organisations(id)%'
    ),
    'organisation_id references organisations'
);

select ok(
    (
        select relrowsecurity
        from pg_class
        where oid = 'public.outbox_events'::regclass
    ),
    'outbox_events has row level security enabled'
);

select is(
    (
        select count(*)::integer
        from pg_policies
        where schemaname = 'public' and tablename = 'outbox_events'
    ),
    0,
    'outbox_events has no browser policies'
);

select ok(
    not has_table_privilege('public', 'public.outbox_events', 'INSERT')
    and not has_table_privilege('public', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('public', 'public.outbox_events', 'DELETE')
    and not has_table_privilege('anon', 'public.outbox_events', 'INSERT')
    and not has_table_privilege('anon', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('anon', 'public.outbox_events', 'DELETE')
    and not has_table_privilege('authenticated', 'public.outbox_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.outbox_events', 'DELETE'),
    'browser roles cannot write outbox events'
);

select ok(
    has_table_privilege('service_role', 'public.outbox_events', 'SELECT')
    and has_table_privilege('service_role', 'public.outbox_events', 'INSERT')
    and has_table_privilege('service_role', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('service_role', 'public.outbox_events', 'DELETE'),
    'service_role has only intended outbox privileges'
);

select ok(
    exists (select 1 from pg_indexes where indexname = 'outbox_events_claim_idx')
    and exists (select 1 from pg_constraint where conname = 'outbox_events_logical_occurrence_unique'),
    'claim and logical-occurrence indexes exist'
);

select ok(
    exists (select 1 from pg_constraint where conname = 'outbox_events_status_check')
    and exists (select 1 from pg_constraint where conname = 'outbox_events_attempt_count_check')
    and exists (select 1 from pg_constraint where conname = 'outbox_events_processed_consistency_check'),
    'status, attempt and processed-time constraints exist'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id, status
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'invalid', 'reservation', '00000000-0000-4000-8000-000000000801', 'completed'
        ) returning id
    $$,
    '23514', null,
    'completed event requires processed_at'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            event_type, aggregate_type, aggregate_id
        ) values (
            'reservation.confirmed', 'reservation', '00000000-0000-4000-8000-000000000800'
        ) returning id
    $$,
    '23502', null,
    'organisation_id is required'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id,
            status, processed_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'invalid', 'reservation', '00000000-0000-4000-8000-000000000802',
            'pending', now()
        ) returning id
    $$,
    '23514', null,
    'non-completed event cannot have processed_at'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id, status
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'invalid', 'reservation', '00000000-0000-4000-8000-000000000803', 'unknown'
        ) returning id
    $$,
    '23514', null,
    'invalid status is rejected'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id, attempt_count
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'invalid', 'reservation', '00000000-0000-4000-8000-000000000804', -1
        ) returning id
    $$,
    '23514', NULL::text,
    'negative attempt_count is rejected'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            ' ', 'reservation', '00000000-0000-4000-8000-000000000805'
        ) returning id
    $$,
    '23514', NULL::text,
    'blank event_type is rejected'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'reservation.confirmed', ' ', '00000000-0000-4000-8000-000000000806'
        ) returning id
    $$,
    '23514', NULL::text,
    'blank aggregate_type is rejected'
);

insert into public.organisations (slug, name, status, default_currency, timezone)
values ('outbox-test-org', 'Outbox Test', 'active', 'EUR', 'Europe/Paris');

create temporary table outbox_state_before as
select
    (select count(*)::integer from public.reservations) as reservation_count,
    (select count(*)::integer from public.allocations) as allocation_count;

insert into public.outbox_events (
    organisation_id, event_type, aggregate_type, aggregate_id, payload
) values (
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation', '00000000-0000-4000-8000-000000000807',
    '{"reservation_id":"00000000-0000-4000-8000-000000000807"}'::jsonb
);

select lives_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id, status, processed_at
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'reservation.confirmed', 'reservation', '00000000-0000-4000-8000-000000000808',
            'completed', now()
        )
    $$,
    'completed event with processed_at is valid'
);

select throws_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id
        ) values (
            (select id from public.organisations where slug = 'igloue'),
            'reservation.confirmed', 'reservation', '00000000-0000-4000-8000-000000000807'
        )
    $$,
    '23505', null,
    'same tenant event and aggregate cannot be duplicated'
);

select lives_ok(
    $$
        insert into public.outbox_events (
            organisation_id, event_type, aggregate_type, aggregate_id
        ) values (
            (select id from public.organisations where slug = 'outbox-test-org'),
            'reservation.confirmed', 'reservation', '00000000-0000-4000-8000-000000000807'
        )
    $$,
    'same aggregate UUID is independent across organisations'
);

select is(
    (
        select count(*)::integer
        from public.reservations
    ),
    (select reservation_count from outbox_state_before),
    'outbox foundation does not change reservation rows'
);

select is(
    (
        select count(*)::integer
        from public.allocations
    ),
    (select allocation_count from outbox_state_before),
    'outbox foundation does not change allocation rows'
);

select * from finish();

rollback;

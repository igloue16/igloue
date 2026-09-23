begin;

select plan(29);

select ok(
    to_regprocedure('public.claim_outbox_events(integer)') is not null,
    'claim function exists with the expected signature'
);

select ok(
    has_function_privilege('service_role', 'public.claim_outbox_events(integer)', 'EXECUTE'),
    'service_role can execute the claim function'
);

select ok(
    not has_function_privilege('public', 'public.claim_outbox_events(integer)', 'EXECUTE'),
    'PUBLIC cannot execute the claim function'
);

select ok(
    not has_function_privilege('anon', 'public.claim_outbox_events(integer)', 'EXECUTE'),
    'anon cannot execute the claim function'
);

select ok(
    not has_function_privilege('authenticated', 'public.claim_outbox_events(integer)', 'EXECUTE'),
    'authenticated cannot execute the claim function'
);

select throws_ok(
    $$ select * from public.claim_outbox_events(null) $$,
    '22023', NULL::text,
    'NULL claim limit is rejected'
);

select throws_ok(
    $$ select * from public.claim_outbox_events(0) $$,
    '22023', NULL::text,
    'zero claim limit is rejected'
);

select throws_ok(
    $$ select * from public.claim_outbox_events(-1) $$,
    '22023', NULL::text,
    'negative claim limit is rejected'
);

select throws_ok(
    $$ select * from public.claim_outbox_events(101) $$,
    '22023', NULL::text,
    'claim limit above 100 is rejected'
);

create temporary table outbox_state_before as
select
    (select count(*)::integer from public.reservations) as reservation_count,
    (select count(*)::integer from public.allocations) as allocation_count;

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at
) values
(
    '00000000-0000-4000-8000-000000002901',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002901',
    '{"order":1}'::jsonb, 'pending', 2, now() - interval '3 minutes'
),
(
    '00000000-0000-4000-8000-000000002902',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002902',
    '{"order":2}'::jsonb, 'pending', 0, now() - interval '2 minutes'
),
(
    '00000000-0000-4000-8000-000000002903',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002903',
    '{"order":3}'::jsonb, 'pending', 0, now() - interval '1 minute'
),
(
    '00000000-0000-4000-8000-000000002904',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002904',
    '{"order":"future"}'::jsonb, 'pending', 0, now() + interval '1 hour'
),
(
    '00000000-0000-4000-8000-000000002905',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002905',
    '{"order":"processing"}'::jsonb, 'pending', 4, now() - interval '5 minutes'
),
(
    '00000000-0000-4000-8000-000000002906',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002906',
    '{"order":"failed"}'::jsonb, 'failed', 1, now() - interval '6 minutes'
);

update public.outbox_events
set status = 'processing',
    lease_expires_at = now() + interval '10 minutes',
    claim_token = '00000000-0000-4000-8000-000000002905'::uuid,
    last_attempt_at = now()
where id = '00000000-0000-4000-8000-000000002905';

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at, processed_at
) values (
    '00000000-0000-4000-8000-000000002907',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000002907',
    '{"order":"completed"}'::jsonb, 'completed', 1,
    now() - interval '7 minutes', now()
);

create temporary table claimed_batch as
select row_number() over ()::integer as claim_position, claimed.*
from public.claim_outbox_events(2) as claimed;

select is(
    (select count(*)::integer from claimed_batch),
    2,
    'available pending events can be claimed up to the requested limit'
);

select ok(
    exists (select 1 from claimed_batch where id = '00000000-0000-4000-8000-000000002901'),
    'oldest available pending event is claimed'
);

select ok(
    not exists (select 1 from claimed_batch where id = '00000000-0000-4000-8000-000000002904'),
    'future pending event is skipped'
);

select ok(
    not exists (select 1 from claimed_batch where id = '00000000-0000-4000-8000-000000002905'),
    'processing event is skipped'
);

select ok(
    not exists (select 1 from claimed_batch where id = '00000000-0000-4000-8000-000000002906'),
    'failed event is skipped'
);

select ok(
    not exists (select 1 from claimed_batch where id = '00000000-0000-4000-8000-000000002907'),
    'completed event is skipped'
);

select is(
    (select status from public.outbox_events where id = '00000000-0000-4000-8000-000000002901'),
    'processing',
    'successful claim changes status to processing'
);

select is(
    (select attempt_count from public.outbox_events where id = '00000000-0000-4000-8000-000000002901'),
    3,
    'successful claim increments attempt_count exactly once'
);

select ok(
    (select last_attempt_at is not null from public.outbox_events where id = '00000000-0000-4000-8000-000000002901'),
    'successful claim populates last_attempt_at'
);

select is(
    (select array_agg(id order by claim_position) from claimed_batch),
    array[
        '00000000-0000-4000-8000-000000002901'::uuid,
        '00000000-0000-4000-8000-000000002902'::uuid
    ],
    'claim order selects the oldest eligible events deterministically'
);

select is(
    (select count(*)::integer from claimed_batch),
    2,
    'p_limit is respected'
);

select is(
    (select count(*)::integer from public.claim_outbox_events(100)),
    1,
    'remaining eligible queue returns one event'
);

select is(
    (select count(*)::integer from public.claim_outbox_events(100)),
    0,
    'empty eligible queue returns zero rows'
);

select is(
    (select organisation_id from claimed_batch where id = '00000000-0000-4000-8000-000000002901'),
    (select id from public.organisations where slug = 'igloue'),
    'organisation_id is preserved'
);

select is(
    (select aggregate_type from claimed_batch where id = '00000000-0000-4000-8000-000000002901'),
    'reservation',
    'aggregate_type is preserved'
);

select is(
    (select aggregate_id from claimed_batch where id = '00000000-0000-4000-8000-000000002901'),
    '00000000-0000-4000-8000-000000002901'::uuid,
    'aggregate_id is preserved'
);

select is(
    (select payload from claimed_batch where id = '00000000-0000-4000-8000-000000002901'),
    '{"order":1}'::jsonb,
    'payload is returned unchanged'
);

select is(
    (select count(*)::integer from public.reservations),
    (select reservation_count from outbox_state_before),
    'claiming events does not change reservation state'
);

select is(
    (select count(*)::integer from public.allocations),
    (select allocation_count from outbox_state_before),
    'claiming events does not change allocation state'
);

select ok(
    not has_table_privilege('public', 'public.outbox_events', 'DELETE')
    and not has_table_privilege('anon', 'public.outbox_events', 'DELETE')
    and not has_table_privilege('authenticated', 'public.outbox_events', 'DELETE')
    and has_table_privilege('service_role', 'public.outbox_events', 'SELECT')
    and has_table_privilege('service_role', 'public.outbox_events', 'INSERT')
    and has_table_privilege('service_role', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('service_role', 'public.outbox_events', 'DELETE'),
    'existing outbox table privileges remain least-privilege'
);

select * from finish();

rollback;

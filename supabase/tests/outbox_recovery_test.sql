begin;

select plan(44);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'outbox_events'
          and column_name = 'lease_expires_at'
          and data_type = 'timestamp with time zone'
          and is_nullable = 'YES'
    ),
    'lease_expires_at column exists'
);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'outbox_events'
          and column_name = 'claim_token'
          and data_type = 'uuid'
          and is_nullable = 'YES'
    ),
    'claim_token column exists'
);

select ok(
    exists (select 1 from pg_constraint where conname = 'outbox_events_processing_lease_check'),
    'processing lease/token consistency constraint exists'
);

select ok(
    to_regprocedure('public.claim_outbox_events(integer)') is not null,
    'claim function exists with expanded contract'
);

select ok(
    to_regprocedure('public.recover_stale_outbox_events(integer)') is not null,
    'recovery function exists with expected signature'
);

select ok(
    has_function_privilege('service_role', 'public.claim_outbox_events(integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.recover_stale_outbox_events(integer)', 'EXECUTE'),
    'service_role can execute claim and recovery'
);

select ok(
    not has_function_privilege('public', 'public.claim_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('public', 'public.recover_stale_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.recover_stale_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.recover_stale_outbox_events(integer)', 'EXECUTE'),
    'browser roles cannot execute claim or recovery'
);

select throws_ok($$ select public.recover_stale_outbox_events(null) $$,
    '22023', NULL::text, 'NULL recovery limit is rejected');
select throws_ok($$ select public.recover_stale_outbox_events(0) $$,
    '22023', NULL::text, 'zero recovery limit is rejected');
select throws_ok($$ select public.recover_stale_outbox_events(-1) $$,
    '22023', NULL::text, 'negative recovery limit is rejected');
select throws_ok($$ select public.recover_stale_outbox_events(101) $$,
    '22023', NULL::text, 'recovery limit above 100 is rejected');

create temporary table outbox_state_before as
select
    (select count(*)::integer from public.reservations) as reservation_count,
    (select count(*)::integer from public.allocations) as allocation_count;

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at
) values
(
    '00000000-0000-4000-8000-000000003001',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003001', '{"kind":"pending"}'::jsonb,
    'pending', 0, now()
),
(
    '00000000-0000-4000-8000-000000003002',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003002', '{"kind":"active"}'::jsonb,
    'pending', 2, now()
),
(
    '00000000-0000-4000-8000-000000003003',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003003', '{"kind":"stale-one"}'::jsonb,
    'pending', 4, now() - interval '10 minutes'
),
(
    '00000000-0000-4000-8000-000000003004',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003004', '{"kind":"stale-two"}'::jsonb,
    'pending', 5, now() - interval '9 minutes'
),
(
    '00000000-0000-4000-8000-000000003005',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003005', '{"kind":"failed"}'::jsonb,
    'failed', 3, now() - interval '8 minutes'
),
(
    '00000000-0000-4000-8000-000000003007',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003007', '{"kind":"pending"}'::jsonb,
    'pending', 0, now() + interval '1 hour'
);

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at, processed_at
) values (
    '00000000-0000-4000-8000-000000003006',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000003006', '{"kind":"completed"}'::jsonb,
    'completed', 1, now() - interval '7 minutes', now()
);

update public.outbox_events
set status = 'processing',
    lease_expires_at = now() + interval '10 minutes',
    claim_token = '00000000-0000-4000-8000-000000003002'::uuid,
    last_attempt_at = now()
where id = '00000000-0000-4000-8000-000000003002';

update public.outbox_events
set status = 'processing',
    lease_expires_at = now() - interval '2 minutes',
    claim_token = '00000000-0000-4000-8000-000000003003'::uuid,
    last_attempt_at = now() - interval '20 minutes'
where id = '00000000-0000-4000-8000-000000003003';

update public.outbox_events
set status = 'processing',
    lease_expires_at = now() - interval '1 minute',
    claim_token = '00000000-0000-4000-8000-000000003004'::uuid,
    last_attempt_at = now() - interval '19 minutes'
where id = '00000000-0000-4000-8000-000000003004';

select ok(
    (select lease_expires_at is null and claim_token is null
     from public.outbox_events where id = '00000000-0000-4000-8000-000000003001'),
    'pending rows have no active lease or token'
);

select ok(
    (select lease_expires_at is null and claim_token is null
     from public.outbox_events where id = '00000000-0000-4000-8000-000000003006'),
    'completed rows have no active lease or token'
);

select ok(
    (select lease_expires_at is null and claim_token is null
     from public.outbox_events where id = '00000000-0000-4000-8000-000000003005'),
    'failed rows have no active lease or token'
);

select ok(
    (select lease_expires_at is not null and claim_token is not null
     from public.outbox_events where id = '00000000-0000-4000-8000-000000003002'),
    'processing rows have a lease and token'
);

create temporary table claimed_batch as
select row_number() over ()::integer as claim_position, claimed.*
from public.claim_outbox_events(1) as claimed;

select is((select count(*)::integer from claimed_batch), 1,
    'claim returns one requested event');
select is((select status from claimed_batch limit 1), 'processing',
    'claim creates processing state');
select ok((select claim_token is not null from claimed_batch limit 1),
    'claim creates a non-null claim token');
select ok((select lease_expires_at is not null from claimed_batch limit 1),
    'claim creates a non-null lease');
select ok((select lease_expires_at between now() + interval '14 minutes'
    and now() + interval '16 minutes' from claimed_batch limit 1),
    'claim lease is approximately 15 minutes');
select is((select attempt_count from claimed_batch limit 1), 1,
    'claim increments attempt_count');

select is(
    (select count(*)::integer from public.claim_outbox_events(100)),
    0,
    'no other eligible pending event remains after the active claim'
);

select is(public.recover_stale_outbox_events(1), 1,
    'recovery respects p_limit');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    'pending', 'expired processing event is recovered');
select ok((select lease_expires_at is null and claim_token is null
    from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    'recovered lease and token are cleared');
select ok((select available_at <= now()
    from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    'recovered event is immediately claimable');
select is((select attempt_count from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    4, 'recovery does not increment attempt_count');
select ok((select last_attempt_at is not null
    from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    'recovery preserves last_attempt_at');

select is(public.recover_stale_outbox_events(100), 1,
    'second stale event is recovered deterministically');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003004'),
    'pending', 'recovery ordering selects the older lease first');

select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003002'),
    'processing', 'active processing event is untouched');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003005'),
    'failed', 'failed event is untouched');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003006'),
    'completed', 'completed event is untouched');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003001'),
    'processing', 'pending event claimed earlier remains processing');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000003007'),
    'pending', 'pending event is untouched by recovery');

select is((select organisation_id from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    (select id from public.organisations where slug = 'igloue'),
    'recovery preserves organisation_id');
select is((select aggregate_type from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    'reservation', 'recovery preserves aggregate_type');
select is((select aggregate_id from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    '00000000-0000-4000-8000-000000003003'::uuid,
    'recovery preserves aggregate_id');
select is((select payload from public.outbox_events where id = '00000000-0000-4000-8000-000000003003'),
    '{"kind":"stale-one"}'::jsonb, 'recovery preserves payload');

create temporary table reclaimed_batch as
select * from public.claim_outbox_events(1);

select is((select count(*)::integer from reclaimed_batch), 1,
    'recovered event can be claimed again');
select ok((select claim_token <> '00000000-0000-4000-8000-000000003003'::uuid
    from reclaimed_batch limit 1),
    'a subsequent claim receives a different token');

select is((select count(*)::integer from public.reservations),
    (select reservation_count from outbox_state_before),
    'claim/recovery do not change reservation state');
select is((select count(*)::integer from public.allocations),
    (select allocation_count from outbox_state_before),
    'claim/recovery do not change allocation state');

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

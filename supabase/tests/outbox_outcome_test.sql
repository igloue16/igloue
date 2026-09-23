begin;

select plan(53);

select ok(to_regprocedure('public.complete_outbox_event(uuid,uuid)') is not null,
    'completion function has the expected signature');
select ok(to_regprocedure('public.retry_outbox_event(uuid,uuid,integer,text)') is not null,
    'retry function has the expected signature');
select ok(to_regprocedure('public.fail_outbox_event(uuid,uuid,text)') is not null,
    'terminal failure function has the expected signature');
select ok(
    has_function_privilege('service_role', 'public.complete_outbox_event(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.retry_outbox_event(uuid,uuid,integer,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fail_outbox_event(uuid,uuid,text)', 'EXECUTE'),
    'service_role can execute all outcome functions');
select ok(
    not has_function_privilege('public', 'public.complete_outbox_event(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.retry_outbox_event(uuid,uuid,integer,text)', 'EXECUTE')
    and not has_function_privilege('public', 'public.fail_outbox_event(uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_outbox_event(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_outbox_event(uuid,uuid)', 'EXECUTE'),
    'browser roles cannot execute outcome functions');
select ok(
    has_table_privilege('service_role', 'public.outbox_events', 'SELECT')
    and has_table_privilege('service_role', 'public.outbox_events', 'INSERT')
    and has_table_privilege('service_role', 'public.outbox_events', 'UPDATE')
    and not has_table_privilege('service_role', 'public.outbox_events', 'DELETE')
    and not has_table_privilege('anon', 'public.outbox_events', 'INSERT'),
    'outbox table privileges remain least-privilege');
select ok(exists (select 1 from pg_constraint where conname = 'outbox_events_last_error_code_check'),
    'error code constraint exists');

select throws_ok($$select public.retry_outbox_event(null,null,null,'provider_timeout')$$, '22023', null::text,
    'NULL retry delay is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,0,'provider_timeout')$$, '22023', null::text,
    'zero retry delay is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,-1,'provider_timeout')$$, '22023', null::text,
    'negative retry delay is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,86401,'provider_timeout')$$, '22023', null::text,
    'retry delay above one day is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,null)$$, '22023', null::text,
    'NULL error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,'')$$, '22023', null::text,
    'empty error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,' Provider_timeout')$$, '22023', null::text,
    'whitespace error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,'Provider_timeout')$$, '22023', null::text,
    'uppercase error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,'provider-timeout')$$, '22023', null::text,
    'punctuated error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,'provider timeout')$$, '22023', null::text,
    'spaced error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,'provider.timeout')$$, '22023', null::text,
    'dotted error code is rejected');
select throws_ok($$select public.retry_outbox_event(null,null,1,repeat('a',65))$$, '22023', null::text,
    'error code longer than 64 characters is rejected');
select throws_ok($$select public.fail_outbox_event(null,null,null)$$, '22023', null::text,
    'terminal failure NULL error code is rejected');
select throws_ok($$select public.fail_outbox_event(null,null,'')$$, '22023', null::text,
    'terminal failure empty error code is rejected');
select throws_ok($$insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id, last_error_code
) values (
    '00000000-0000-4000-8000-000000004099',
    (select id from public.organisations where slug = 'igloue'),
    'invalid.error', 'reservation', '00000000-0000-4000-8000-000000004099', 'Bad-Code'
)$$, '23514', null::text,
    'table constraint rejects invalid stored error code');

select ok('provider_timeout' ~ '^[a-z0-9_]+$' and length('provider_timeout') <= 64,
    'representative provider-neutral error code is structurally valid');

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at, last_attempt_at,
    lease_expires_at, claim_token
) values (
    '00000000-0000-4000-8000-000000004001',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000004001', '{"kind":"complete"}'::jsonb,
    'processing', 3, now() - interval '1 hour', now() - interval '20 minutes',
    now() - interval '1 minute', '00000000-0000-4000-8000-000000004011'
);

select ok(public.complete_outbox_event(
    '00000000-0000-4000-8000-000000004001',
    '00000000-0000-4000-8000-000000004011'),
    'matching token completes processing event after nominal lease expiry');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'), 'completed',
    'completion sets completed status');
select ok((select processed_at is not null from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'),
    'completion populates processed_at');
select ok((select lease_expires_at is null and claim_token is null from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'),
    'completion clears lease and claim token');
select ok((select last_error_code is null from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'),
    'completion clears previous error');
select is((select attempt_count from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'), 3,
    'completion preserves attempt_count');
select is((select organisation_id from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'),
    (select id from public.organisations where slug = 'igloue'), 'completion preserves organisation');
select is((select aggregate_type from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'), 'reservation',
    'completion preserves aggregate type');
select is((select aggregate_id from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'),
    '00000000-0000-4000-8000-000000004001'::uuid, 'completion preserves aggregate id');
select is((select payload from public.outbox_events where id = '00000000-0000-4000-8000-000000004001'), '{"kind":"complete"}'::jsonb,
    'completion preserves payload');
select ok(not public.complete_outbox_event('00000000-0000-4000-8000-000000004001','00000000-0000-4000-8000-000000004011'),
    'duplicate completion with old token returns false');
select ok(not public.complete_outbox_event('00000000-0000-4000-8000-000000004099','00000000-0000-4000-8000-000000004011'),
    'completion of nonexistent event returns false');

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at, last_attempt_at,
    lease_expires_at, claim_token
) values (
    '00000000-0000-4000-8000-000000004002',
    (select id from public.organisations where slug = 'igloue'),
    'payment.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000004002', '{"kind":"retry"}'::jsonb,
    'processing', 2, now(), now() - interval '3 minutes',
    now() + interval '10 minutes', '00000000-0000-4000-8000-000000004012'
);

select ok(public.retry_outbox_event('00000000-0000-4000-8000-000000004002','00000000-0000-4000-8000-000000004012',60,'provider_timeout'),
    'matching token retries processing event');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'pending', 'retry returns event to pending');
select ok((select available_at > now() from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'retry schedules a future availability time');
select ok((select available_at between now() + interval '59 seconds' and now() + interval '61 seconds' from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'retry delay is approximately requested');
select ok((select lease_expires_at is null and claim_token is null from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'retry clears lease and token');
select is((select last_error_code from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'provider_timeout', 'retry stores provider-neutral error code');
select ok((select processed_at is null from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 'retry leaves processed_at null');
select is((select attempt_count from public.outbox_events where id = '00000000-0000-4000-8000-000000004002'), 2, 'retry preserves attempt_count');
select ok(not public.retry_outbox_event('00000000-0000-4000-8000-000000004002','00000000-0000-4000-8000-000000004012',60,'provider_timeout'), 'duplicate retry with old token returns false');

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at, last_attempt_at,
    lease_expires_at, claim_token
) values (
    '00000000-0000-4000-8000-000000004003',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.cancelled', 'reservation',
    '00000000-0000-4000-8000-000000004003', '{"kind":"failed"}'::jsonb,
    'processing', 1, now(), now() - interval '2 minutes',
    now() + interval '10 minutes', '00000000-0000-4000-8000-000000004013'
);

select ok(public.fail_outbox_event('00000000-0000-4000-8000-000000004003','00000000-0000-4000-8000-000000004013','invalid_event_payload'), 'matching token marks terminal failure');
select is((select status from public.outbox_events where id = '00000000-0000-4000-8000-000000004003'), 'failed', 'terminal failure sets failed status');
select ok((select lease_expires_at is null and claim_token is null and processed_at is null from public.outbox_events where id = '00000000-0000-4000-8000-000000004003'), 'terminal failure clears ownership and processed time');
select is((select last_error_code from public.outbox_events where id = '00000000-0000-4000-8000-000000004003'), 'invalid_event_payload', 'terminal failure stores error code');
select is((select attempt_count from public.outbox_events where id = '00000000-0000-4000-8000-000000004003'), 1, 'terminal failure preserves attempt_count');
select is((select count(*)::integer from public.claim_outbox_events(100) where id = '00000000-0000-4000-8000-000000004003'), 0, 'failed event remains unclaimable');
select ok(not public.fail_outbox_event('00000000-0000-4000-8000-000000004003','00000000-0000-4000-8000-000000004013','another_error'), 'duplicate terminal failure with old token returns false');

insert into public.outbox_events (
    id, organisation_id, event_type, aggregate_type, aggregate_id,
    payload, status, attempt_count, available_at,
    lease_expires_at, claim_token
) values (
    '00000000-0000-4000-8000-000000004004',
    (select id from public.organisations where slug = 'igloue'),
    'reservation.confirmed', 'reservation',
    '00000000-0000-4000-8000-000000004004', '{"kind":"stale"}'::jsonb,
    'processing', 1, now(), now() - interval '1 minute',
    '00000000-0000-4000-8000-000000004014'
);
select is(public.recover_stale_outbox_events(1), 1, 'recovery removes stale ownership');
select ok(not public.complete_outbox_event('00000000-0000-4000-8000-000000004004','00000000-0000-4000-8000-000000004014'), 'stale token after recovery returns false');

select finish();
rollback;

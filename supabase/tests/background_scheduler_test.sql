begin;

select plan(14);

select ok(
    exists (select 1 from pg_extension where extname = 'pg_net'),
    'pg_net is installed for scheduled Edge invocation'
);

select ok(
    to_regprocedure('private.enqueue_internal_edge_call(text)') is not null,
    'runtime invocation helper exists'
);

select ok(
    not has_function_privilege('public', 'private.enqueue_internal_edge_call(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.enqueue_internal_edge_call(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.enqueue_internal_edge_call(text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.enqueue_internal_edge_call(text)', 'EXECUTE'),
    'browser and API roles cannot invoke the scheduler helper'
);

select ok(
    not has_function_privilege('anon', 'private.configure_background_jobs()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.configure_background_jobs()', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.configure_background_jobs()', 'EXECUTE'),
    'browser and API roles cannot reconfigure scheduled jobs'
);

select private.configure_background_jobs();

select is(
    (select count(*)::integer from cron.job where jobname = 'igloue-provider-event-recovery'),
    1,
    'provider recovery job exists exactly once after setup is reapplied'
);

select is(
    (select schedule from cron.job where jobname = 'igloue-provider-event-recovery'),
    '* * * * *',
    'provider recovery cadence is one minute'
);

select is(
    (select command from cron.job where jobname = 'igloue-provider-event-recovery'),
    $command$select private.enqueue_internal_edge_call('recover-stripe-events');$command$,
    'provider recovery job uses the deterministic internal invocation command'
);

select is(
    (select count(*)::integer from cron.job where jobname = 'igloue-confirmation-outbox'),
    1,
    'outbox job exists exactly once after setup is reapplied'
);

select is(
    (select schedule from cron.job where jobname = 'igloue-confirmation-outbox'),
    '* * * * *',
    'outbox cadence is one minute'
);

select is(
    (select command from cron.job where jobname = 'igloue-confirmation-outbox'),
    $command$select private.enqueue_internal_edge_call('process-outbox');$command$,
    'outbox job uses the deterministic internal invocation command'
);

select ok(
    (select schedule = '*/5 * * * *'
        and command = 'select public.cleanup_expired_reservation_holds(100);'
     from cron.job where jobname = 'igloue-expired-hold-cleanup'),
    'existing expired-hold cleanup schedule is unchanged'
);

select ok(
    position('igloue_internal_functions_base_url' in pg_get_functiondef(
        'private.enqueue_internal_edge_call(text)'::regprocedure
    )) > 0
    and position('igloue_internal_edge_secret_key' in pg_get_functiondef(
        'private.enqueue_internal_edge_call(text)'::regprocedure
    )) > 0,
    'runtime helper reads named Vault entries'
);

select ok(
    position('service_role_key' in (select command from cron.job where jobname = 'igloue-provider-event-recovery')) = 0
    and position('service_role_key' in (select command from cron.job where jobname = 'igloue-confirmation-outbox')) = 0,
    'scheduled command text contains no service credential'
);

select ok(
    not has_function_privilege('anon', 'public.recover_stale_outbox_events(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.recover_stale_outbox_events(integer)', 'EXECUTE'),
    'browser roles cannot invoke stale outbox recovery directly'
);

select * from finish();
rollback;

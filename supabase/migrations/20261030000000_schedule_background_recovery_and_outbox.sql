-- Schedule privileged payment-event recovery and confirmation outbox work.
-- Endpoint configuration and service credentials are read from Supabase Vault
-- at execution time. No environment-specific values belong in this migration.

create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

drop function if exists private.enqueue_internal_edge_call(text);

create function private.enqueue_internal_edge_call(p_function_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_functions_base_url text;
    v_edge_secret_key text;
    v_request_id bigint;
begin
    if p_function_name is null
       or p_function_name not in ('recover-stripe-events', 'process-outbox') then
        raise exception 'unsupported scheduled Edge Function'
            using errcode = '22023';
    end if;

    select nullif(pg_catalog.btrim(s.decrypted_secret), '')
    into v_functions_base_url
    from vault.decrypted_secrets as s
    where s.name = 'igloue_internal_functions_base_url'
    limit 1;

    select nullif(pg_catalog.btrim(s.decrypted_secret), '')
    into v_edge_secret_key
    from vault.decrypted_secrets as s
    where s.name = 'igloue_internal_edge_secret_key'
    limit 1;

    -- A fresh environment can apply migrations before deployment-time Vault
    -- provisioning. Do nothing until both runtime values are present.
    if v_functions_base_url is null or v_edge_secret_key is null then
        return null;
    end if;

    select net.http_post(
        url := pg_catalog.rtrim(v_functions_base_url, '/') || '/' || p_function_name,
        body := '{}'::jsonb,
        headers := pg_catalog.jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_edge_secret_key,
            'apikey', v_edge_secret_key
        ),
        timeout_milliseconds := 120000
    )
    into v_request_id;

    return v_request_id;
end;
$$;

revoke all on function private.enqueue_internal_edge_call(text)
    from public, anon, authenticated, service_role;
grant execute on function private.enqueue_internal_edge_call(text) to postgres;

create or replace function private.configure_background_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job record;
begin
    for v_job in
        select j.jobid
        from cron.job as j
        where j.jobname in (
            'igloue-provider-event-recovery',
            'igloue-confirmation-outbox'
        )
    loop
        perform cron.unschedule(v_job.jobid);
    end loop;

    perform cron.schedule(
        'igloue-provider-event-recovery',
        '* * * * *',
        $command$select private.enqueue_internal_edge_call('recover-stripe-events');$command$
    );

    perform cron.schedule(
        'igloue-confirmation-outbox',
        '* * * * *',
        $command$select private.enqueue_internal_edge_call('process-outbox');$command$
    );
end;
$$;

revoke all on function private.configure_background_jobs()
    from public, anon, authenticated, service_role;
grant execute on function private.configure_background_jobs() to postgres;

select private.configure_background_jobs();

-- Correct scheduled Edge authentication for current sb_secret API keys.
-- The existing cron jobs keep calling this helper; replacing its definition
-- updates deployed environments without changing jobs or Vault contents.

create or replace function private.enqueue_internal_edge_call(p_function_name text)
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

    if v_functions_base_url is null or v_edge_secret_key is null then
        return null;
    end if;

    select net.http_post(
        url := pg_catalog.rtrim(v_functions_base_url, '/') || '/' || p_function_name,
        body := '{}'::jsonb,
        headers := pg_catalog.jsonb_build_object(
            'Content-Type', 'application/json',
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

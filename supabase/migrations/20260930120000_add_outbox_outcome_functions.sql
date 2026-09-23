-- Trusted worker outcome transitions for leased transactional outbox events.
-- A claim token, not lease time, is the ownership authority for reporting an outcome.

alter table public.outbox_events
    add constraint outbox_events_last_error_code_check
    check (
        last_error_code is null
        or (
            length(last_error_code) between 1 and 64
            and last_error_code = trim(last_error_code)
            and last_error_code ~ '^[a-z0-9_]+$'
        )
    );

create function public.complete_outbox_event(
    p_event_id uuid,
    p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_updated integer;
begin
    update public.outbox_events
    set status = 'completed',
        processed_at = now(),
        lease_expires_at = null,
        claim_token = null,
        last_error_code = null
    where id = p_event_id
      and status = 'processing'
      and claim_token = p_claim_token;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.complete_outbox_event(uuid, uuid) from public;
revoke all on function public.complete_outbox_event(uuid, uuid) from anon, authenticated;
grant execute on function public.complete_outbox_event(uuid, uuid) to service_role;

create function public.retry_outbox_event(
    p_event_id uuid,
    p_claim_token uuid,
    p_retry_delay_seconds integer,
    p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_updated integer;
begin
    if p_retry_delay_seconds is null
       or p_retry_delay_seconds < 1
       or p_retry_delay_seconds > 86400 then
        raise exception 'retry delay must be between 1 and 86400 seconds'
            using errcode = '22023';
    end if;

    if p_error_code is null
       or length(p_error_code) < 1
       or length(p_error_code) > 64
       or p_error_code <> trim(p_error_code)
       or p_error_code !~ '^[a-z0-9_]+$' then
        raise exception 'invalid outbox error code'
            using errcode = '22023';
    end if;

    update public.outbox_events
    set status = 'pending',
        available_at = now() + make_interval(secs => p_retry_delay_seconds),
        lease_expires_at = null,
        claim_token = null,
        last_error_code = p_error_code,
        processed_at = null
    where id = p_event_id
      and status = 'processing'
      and claim_token = p_claim_token;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.retry_outbox_event(uuid, uuid, integer, text) from public;
revoke all on function public.retry_outbox_event(uuid, uuid, integer, text) from anon, authenticated;
grant execute on function public.retry_outbox_event(uuid, uuid, integer, text) to service_role;

create function public.fail_outbox_event(
    p_event_id uuid,
    p_claim_token uuid,
    p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_updated integer;
begin
    if p_error_code is null
       or length(p_error_code) < 1
       or length(p_error_code) > 64
       or p_error_code <> trim(p_error_code)
       or p_error_code !~ '^[a-z0-9_]+$' then
        raise exception 'invalid outbox error code'
            using errcode = '22023';
    end if;

    update public.outbox_events
    set status = 'failed',
        lease_expires_at = null,
        claim_token = null,
        last_error_code = p_error_code,
        processed_at = null
    where id = p_event_id
      and status = 'processing'
      and claim_token = p_claim_token;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.fail_outbox_event(uuid, uuid, text) from public;
revoke all on function public.fail_outbox_event(uuid, uuid, text) from anon, authenticated;
grant execute on function public.fail_outbox_event(uuid, uuid, text) to service_role;

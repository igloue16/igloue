-- P3E4B: recover only durably matched, unfinished Stripe payment events.
-- Raw Stripe payloads are not retained, so recovery intentionally starts
-- after successful normalized matching and reuses the existing authority RPC.

alter table public.payment_provider_events
    add column recovery_attempt_count integer not null default 0,
    add column recovery_next_attempt_at timestamptz not null default now(),
    add column recovery_lease_until timestamptz,
    add column recovery_claim_token uuid,
    add column recovery_last_attempt_at timestamptz,
    add column recovery_error_class text,
    add column recovery_terminal_at timestamptz,
    add constraint payment_provider_events_recovery_attempt_count_check
        check (recovery_attempt_count between 0 and 8),
    add constraint payment_provider_events_recovery_lease_check
        check ((recovery_lease_until is null) = (recovery_claim_token is null)),
    add constraint payment_provider_events_recovery_error_class_check
        check (recovery_error_class is null or recovery_error_class in (
            'not_authoritative', 'authority_rpc_unavailable',
            'invalid_authority_response', 'retry_exhausted'
        ));

create index payment_provider_events_recovery_idx
    on public.payment_provider_events (
        recovery_next_attempt_at, recovery_lease_until, created_at, id
    )
    where provider = 'stripe'
      and event_type = 'checkout.session.completed'
      and status = 'received'
      and matched_at is not null
      and conflict_detected_at is null
      and recovery_terminal_at is null;

create function public.claim_payment_provider_event_recovery(
    p_limit integer,
    p_expected_livemode boolean
)
returns table (event_id uuid, claim_token uuid, attempt_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_now timestamptz := clock_timestamp();
begin
    if p_limit is null or p_limit < 1 or p_limit > 20 or p_expected_livemode is null then
        raise exception 'recovery claim requires limit 1..20 and expected livemode'
            using errcode = '22023';
    end if;

    -- A worker that dies on its eighth claim leaves no callback to record
    -- exhaustion. On the next invocation, terminalize only a bounded set of
    -- expired leases instead of retrying those events forever.
    with exhausted as (
        select pe.id
        from public.payment_provider_events as pe
        where pe.provider = 'stripe'
          and pe.event_type = 'checkout.session.completed'
          and pe.status = 'received'
          and pe.organisation_id is not null
          and pe.payment_attempt_id is not null
          and pe.matched_at is not null
          and pe.conflict_detected_at is null
          and pe.payload_sha256 ~ '^[0-9a-f]{64}$'
          and pe.livemode = p_expected_livemode
          and pe.recovery_terminal_at is null
          and pe.recovery_attempt_count >= 8
          and pe.recovery_next_attempt_at <= v_now
          and (pe.recovery_lease_until is null or pe.recovery_lease_until <= v_now)
        order by pe.recovery_lease_until nulls first, pe.recovery_last_attempt_at,
            pe.created_at, pe.id
        for update skip locked
        limit p_limit
    )
    update public.payment_provider_events as pe
    set status = 'ignored',
        recovery_error_class = 'retry_exhausted',
        recovery_terminal_at = v_now,
        recovery_lease_until = null,
        recovery_claim_token = null
    from exhausted as x
    where pe.id = x.id;

    return query
    with candidates as (
        select pe.id
        from public.payment_provider_events as pe
        where pe.provider = 'stripe'
          and pe.event_type = 'checkout.session.completed'
          and pe.status = 'received'
          and pe.organisation_id is not null
          and pe.payment_attempt_id is not null
          and pe.matched_at is not null
          and pe.conflict_detected_at is null
          and pe.payload_sha256 ~ '^[0-9a-f]{64}$'
          and pe.livemode = p_expected_livemode
          and pe.recovery_terminal_at is null
          and pe.recovery_attempt_count < 8
          and pe.recovery_next_attempt_at <= v_now
          and (pe.recovery_lease_until is null or pe.recovery_lease_until <= v_now)
        order by pe.recovery_next_attempt_at, pe.created_at, pe.id
        for update skip locked
        limit p_limit
    ), claimed as (
        update public.payment_provider_events as pe
        set recovery_attempt_count = pe.recovery_attempt_count + 1,
            recovery_last_attempt_at = v_now,
            recovery_lease_until = v_now + interval '5 minutes',
            recovery_claim_token = pg_catalog.gen_random_uuid()
        from candidates as c
        where pe.id = c.id
        returning pe.id, pe.recovery_claim_token, pe.recovery_attempt_count,
            pe.recovery_next_attempt_at, pe.created_at
    )
    select c.id, c.recovery_claim_token, c.recovery_attempt_count
    from claimed as c
    order by c.recovery_next_attempt_at, c.created_at, c.id;
end;
$$;

revoke all on function public.claim_payment_provider_event_recovery(integer, boolean) from public;
revoke all on function public.claim_payment_provider_event_recovery(integer, boolean) from anon, authenticated;
grant execute on function public.claim_payment_provider_event_recovery(integer, boolean) to service_role;

create function public.record_payment_provider_event_recovery(
    p_event_id uuid,
    p_claim_token uuid,
    p_result text,
    p_error_class text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event public.payment_provider_events%rowtype;
    v_now timestamptz := clock_timestamp();
    v_delay_seconds integer;
begin
    if p_event_id is null or p_claim_token is null
       or p_result is null
       or p_result not in ('processed', 'not_authoritative', 'transient_error') then
        raise exception 'invalid provider-event recovery result' using errcode = '22023';
    end if;
    if p_result = 'transient_error'
       and (p_error_class is null
            or p_error_class not in ('authority_rpc_unavailable', 'invalid_authority_response')) then
        raise exception 'invalid provider-event recovery error class' using errcode = '22023';
    end if;
    if p_result <> 'transient_error' and p_error_class is not null then
        raise exception 'unexpected provider-event recovery error class' using errcode = '22023';
    end if;

    select pe.* into v_event
    from public.payment_provider_events as pe
    where pe.id = p_event_id and pe.recovery_claim_token = p_claim_token
    for update;
    if not found then
        return 'lost_claim';
    end if;

    -- Authority may have committed before the worker lost its response.
    if v_event.status = 'processed' then
        update public.payment_provider_events as pe
        set recovery_lease_until = null,
            recovery_claim_token = null,
            recovery_error_class = null
        where pe.id = p_event_id;
        return 'completed';
    end if;

    -- A concurrent authenticated delivery may have marked a digest conflict.
    -- Never overwrite that terminal receipt state.
    if v_event.status in ('failed', 'ignored') or v_event.conflict_detected_at is not null then
        update public.payment_provider_events as pe
        set recovery_lease_until = null,
            recovery_claim_token = null
        where pe.id = p_event_id;
        return 'terminal';
    end if;

    if v_event.status <> 'received' then
        return 'lost_claim';
    end if;

    if p_result = 'processed' then
        raise exception 'payment authority did not finalize the provider event'
            using errcode = 'P0001';
    elsif p_result = 'not_authoritative' then
        update public.payment_provider_events as pe
        set status = 'ignored',
            recovery_error_class = 'not_authoritative',
            recovery_terminal_at = v_now,
            recovery_lease_until = null,
            recovery_claim_token = null
        where pe.id = p_event_id;
        return 'terminal';
    end if;

    if v_event.recovery_attempt_count >= 8 then
        update public.payment_provider_events as pe
        set status = 'ignored',
            recovery_error_class = 'retry_exhausted',
            recovery_terminal_at = v_now,
            recovery_lease_until = null,
            recovery_claim_token = null
        where pe.id = p_event_id;
        return 'retry_exhausted';
    end if;

    v_delay_seconds := least(3600, 30 * (2 ^ (v_event.recovery_attempt_count - 1))::integer);
    update public.payment_provider_events as pe
    set recovery_next_attempt_at = v_now + pg_catalog.make_interval(secs => v_delay_seconds),
        recovery_error_class = p_error_class,
        recovery_lease_until = null,
        recovery_claim_token = null
    where pe.id = p_event_id;
    return 'retry_scheduled';
end;
$$;

revoke all on function public.record_payment_provider_event_recovery(uuid, uuid, text, text) from public;
revoke all on function public.record_payment_provider_event_recovery(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.record_payment_provider_event_recovery(uuid, uuid, text, text) to service_role;

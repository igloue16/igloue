-- Trusted durable receipt boundary for already authenticated provider events.
-- This function records/deduplicates receipts only; business matching is later.

create function public.receive_payment_provider_event(
    p_provider text,
    p_provider_event_id text,
    p_event_type text,
    p_provider_event_created_at timestamptz,
    p_livemode boolean,
    p_payload_sha256 text
)
returns table (
    outcome text,
    event_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event_id uuid;
    v_existing public.payment_provider_events%rowtype;
begin
    if p_provider is distinct from 'stripe'
       or p_provider_event_id is null
       or length(trim(p_provider_event_id)) not between 1 and 255
       or p_provider_event_id <> trim(p_provider_event_id)
       or p_event_type is null
       or length(trim(p_event_type)) not between 1 and 255
       or p_event_type <> trim(p_event_type)
       or p_provider_event_created_at is null
       or p_livemode is null
       or p_payload_sha256 is null
       or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid payment provider event receipt'
            using errcode = '22023';
    end if;

    insert into public.payment_provider_events (
        organisation_id,
        payment_attempt_id,
        provider,
        provider_event_id,
        event_type,
        status,
        provider_event_created_at,
        livemode,
        payload_sha256,
        conflict_detected_at,
        last_error_code
    ) values (
        null,
        null,
        p_provider,
        p_provider_event_id,
        p_event_type,
        'received',
        p_provider_event_created_at,
        p_livemode,
        p_payload_sha256,
        null,
        null
    )
    on conflict (provider, provider_event_id) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
        return query select 'recorded'::text, v_event_id;
        return;
    end if;

    -- The unique-index conflict has waited for any concurrent inserter. A new
    -- statement snapshot now sees the committed row and the lock serializes
    -- conflict marking with any other duplicate delivery.
    select *
    into v_existing
    from public.payment_provider_events
    where provider = p_provider
      and provider_event_id = p_provider_event_id
    for update;

    if not found then
        raise exception 'payment provider event receipt unavailable'
            using errcode = 'P0001';
    end if;

    if v_existing.payload_sha256 is not distinct from p_payload_sha256 then
        return query select 'duplicate'::text, v_existing.id;
        return;
    end if;

    -- A NULL legacy digest is intentionally not upgraded: its original body
    -- cannot be proven identical to the newly authenticated request.
    update public.payment_provider_events
    set status = 'failed',
        processed_at = null,
        conflict_detected_at = coalesce(conflict_detected_at, now()),
        last_error_code = 'conflicting_payload_digest'
    where id = v_existing.id;

    return query select 'conflict'::text, v_existing.id;
end;
$$;

revoke all on function public.receive_payment_provider_event(text, text, text, timestamptz, boolean, text) from public;
revoke all on function public.receive_payment_provider_event(text, text, text, timestamptz, boolean, text) from anon, authenticated;
grant execute on function public.receive_payment_provider_event(text, text, text, timestamptz, boolean, text) to service_role;

-- Normalize Checkout persistence to the shared lifecycle lock order:
-- reservation -> allocations -> payment attempt.

create or replace function public.persist_reservation_payment_checkout(
    p_payment_attempt_id uuid,
    p_organisation_id uuid,
    p_provider_checkout_session_id text,
    p_provider_checkout_url text,
    p_provider_payment_intent_id text default null
)
returns table (
    provider_checkout_session_id text,
    provider_checkout_url text,
    hold_expires_at timestamptz,
    eligible boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
    v_reservation public.reservations%rowtype;
    v_state record;
begin
    if p_provider_checkout_session_id is null
       or length(trim(p_provider_checkout_session_id)) = 0
       or p_provider_checkout_url is null
       or length(trim(p_provider_checkout_url)) = 0 then
        raise exception 'invalid checkout state' using errcode = '22023';
    end if;

    -- Lock the reservation first, then all allocations deterministically,
    -- before locking the payment attempt.
    select r.*
    into v_reservation
    from public.reservations as r
    join public.payment_attempts as pa
      on pa.reservation_id = r.id
     and pa.organisation_id = r.organisation_id
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id
    for update of r;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    perform 1
    from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;

    select *
    into v_attempt
    from public.payment_attempts as pa
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id
    for update;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    if v_attempt.provider_checkout_session_id is not null
       and v_attempt.provider_checkout_session_id <> p_provider_checkout_session_id then
        raise exception 'conflicting checkout session' using errcode = 'P0001';
    end if;

    if v_attempt.provider_checkout_url is not null
       and v_attempt.provider_checkout_url <> p_provider_checkout_url then
        raise exception 'conflicting checkout url' using errcode = 'P0001';
    end if;

    if p_provider_payment_intent_id is not null
       and v_attempt.provider_payment_intent_id is not null
       and v_attempt.provider_payment_intent_id <> p_provider_payment_intent_id then
        raise exception 'conflicting payment intent' using errcode = 'P0001';
    end if;

    select *
    into v_state
    from public.get_reservation_payment_checkout(
        p_payment_attempt_id,
        p_organisation_id
    );

    if v_attempt.status not in ('created', 'checkout_open') then
        raise exception 'payment attempt is not reusable' using errcode = 'P0001';
    end if;

    update public.payment_attempts as pa
    set provider_checkout_session_id = p_provider_checkout_session_id,
        provider_checkout_url = p_provider_checkout_url,
        provider_payment_intent_id = coalesce(
            p_provider_payment_intent_id,
            pa.provider_payment_intent_id
        ),
        status = 'checkout_open',
        updated_at = now()
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id;

    return query
    select p_provider_checkout_session_id,
           p_provider_checkout_url,
           v_state.hold_expires_at,
           v_state.eligible;
end;
$$;

revoke all on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) from public;
revoke all on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) to service_role;

-- Trusted matching/linking boundary for authenticated, normalized Stripe events.
-- This function links evidence only; payment and reservation business state remain unchanged.

create function public.match_payment_provider_event(
    p_provider_event_id text,
    p_checkout_session_id text,
    p_amount_total bigint,
    p_currency text,
    p_mode text,
    p_checkout_status text,
    p_payment_status text,
    p_payment_intent_id text,
    p_client_reference_id uuid,
    p_metadata_payment_attempt_id uuid,
    p_metadata_reservation_id uuid,
    p_expected_livemode boolean
)
returns table (
    outcome text,
    payment_attempt_id uuid,
    reservation_id uuid,
    organisation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event public.payment_provider_events%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_reservation public.reservations%rowtype;
    v_attempt_count integer;
    v_expected_cents bigint;
    v_outcome text;
begin
    if p_provider_event_id is null
       or length(trim(p_provider_event_id)) not between 1 and 255
       or p_provider_event_id <> trim(p_provider_event_id)
       or p_checkout_session_id is null
       or length(trim(p_checkout_session_id)) not between 1 and 255
       or p_checkout_session_id <> trim(p_checkout_session_id)
       or p_amount_total is null
       or p_amount_total < 0
       or p_currency is distinct from 'eur'
       or p_mode is distinct from 'payment'
       or p_checkout_status is distinct from 'complete'
       or p_payment_status is distinct from 'paid'
       or p_payment_intent_id is null
       or length(trim(p_payment_intent_id)) not between 1 and 255
       or p_payment_intent_id <> trim(p_payment_intent_id)
       or p_client_reference_id is null
       or p_metadata_payment_attempt_id is null
       or p_metadata_reservation_id is null
       or p_expected_livemode is null then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    -- Read first without locking so unknown event IDs do not lock business rows.
    select *
    into v_event
    from public.payment_provider_events as pe
    where pe.provider = 'stripe'
      and pe.provider_event_id = p_provider_event_id;

    if not found then
        return query select
            'unknown_provider_event'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_event.conflict_detected_at is not null
       or v_event.payload_sha256 is null
       or v_event.payload_sha256 !~ '^[0-9a-f]{64}$' then
        return query select
            'conflict'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_event.event_type <> 'checkout.session.completed'
       or v_event.livemode is null
       or v_event.livemode <> p_expected_livemode
       or v_event.status not in ('received', 'processed') then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    -- Lock order is payment attempt, then provider event. This preserves the
    -- reservation -> allocation -> attempt -> event suffix planned for P3E.
    select count(*)::integer
    into v_attempt_count
    from public.payment_attempts as pa
    where pa.provider = 'stripe'
      and pa.provider_checkout_session_id = p_checkout_session_id;

    if v_attempt_count = 0 then
        return query select
            'unknown_checkout_session'::text, null::uuid, null::uuid, null::uuid;
        return;
    elsif v_attempt_count <> 1 then
        return query select
            'conflict'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    select *
    into v_attempt
    from public.payment_attempts as pa
    where pa.provider = 'stripe'
      and pa.provider_checkout_session_id = p_checkout_session_id
    for update;

    -- Re-read and lock the receipt after locking the attempt. A concurrent
    -- matcher cannot link this event differently or bypass a digest conflict.
    select *
    into v_event
    from public.payment_provider_events as pe
    where pe.id = v_event.id
    for update;

    if not found then
        return query select
            'unknown_provider_event'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_event.conflict_detected_at is not null
       or v_event.payload_sha256 is null
       or v_event.payload_sha256 !~ '^[0-9a-f]{64}$' then
        return query select
            'conflict'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_event.event_type <> 'checkout.session.completed'
       or v_event.livemode is null
       or v_event.livemode <> p_expected_livemode
       or v_event.status not in ('received', 'processed') then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_attempt.provider <> 'stripe'
       or v_attempt.purpose <> 'rental'
       or v_attempt.status not in ('created', 'checkout_open', 'paid', 'requires_review') then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_attempt.currency <> 'EUR'
       or v_attempt.amount < 0
       or v_attempt.amount * 100 <> trunc(v_attempt.amount * 100) then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;
    v_expected_cents := (v_attempt.amount * 100)::bigint;
    if v_expected_cents <> p_amount_total then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    select *
    into v_reservation
    from public.reservations as r
    where r.id = v_attempt.reservation_id
      and r.organisation_id = v_attempt.organisation_id;

    if not found or v_reservation.total_amount <> v_attempt.amount then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if p_client_reference_id <> v_attempt.id
       or p_metadata_payment_attempt_id <> v_attempt.id
       or p_metadata_reservation_id <> v_attempt.reservation_id then
        return query select
            'validation_failed'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_attempt.provider_payment_intent_id is not null
       and v_attempt.provider_payment_intent_id <> p_payment_intent_id then
        return query select
            'conflict'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_attempt.provider_payment_intent_id is null then
        if exists (
            select 1
            from public.payment_attempts as other_attempt
            where other_attempt.provider = 'stripe'
              and other_attempt.provider_payment_intent_id = p_payment_intent_id
              and other_attempt.id <> v_attempt.id
        ) then
            return query select
                'conflict'::text, null::uuid, null::uuid, null::uuid;
            return;
        end if;

        begin
            update public.payment_attempts as pa
            set provider_payment_intent_id = p_payment_intent_id,
                updated_at = now()
            where pa.id = v_attempt.id
              and pa.organisation_id = v_attempt.organisation_id;
        exception when unique_violation then
            return query select
                'conflict'::text, null::uuid, null::uuid, null::uuid;
            return;
        end;
    end if;

    if (v_event.payment_attempt_id is null) <> (v_event.organisation_id is null) then
        return query select
            'conflict'::text, null::uuid, null::uuid, null::uuid;
        return;
    end if;

    if v_event.payment_attempt_id is not null then
        if v_event.payment_attempt_id <> v_attempt.id
           or v_event.organisation_id <> v_attempt.organisation_id then
            return query select
                'conflict'::text, null::uuid, null::uuid, null::uuid;
            return;
        end if;

        v_outcome := case
            when v_attempt.status in ('paid', 'requires_review') then 'already_matched'
            else 'already_matched'
        end;
        return query select v_outcome, v_attempt.id,
            v_attempt.reservation_id, v_attempt.organisation_id;
        return;
    end if;

    update public.payment_provider_events as pe
    set payment_attempt_id = v_attempt.id,
        organisation_id = v_attempt.organisation_id
    where pe.id = v_event.id
      and pe.payment_attempt_id is null
      and pe.organisation_id is null;

    v_outcome := case
        when v_attempt.status in ('paid', 'requires_review') then 'already_matched'
        else 'matched'
    end;
    return query select v_outcome, v_attempt.id,
        v_attempt.reservation_id, v_attempt.organisation_id;
end;
$$;

revoke all on function public.match_payment_provider_event(
    text, text, bigint, text, text, text, text, text,
    uuid, uuid, uuid, boolean
) from public;
revoke all on function public.match_payment_provider_event(
    text, text, bigint, text, text, text, text, text,
    uuid, uuid, uuid, boolean
) from anon, authenticated;
grant execute on function public.match_payment_provider_event(
    text, text, bigint, text, text, text, text, text,
    uuid, uuid, uuid, boolean
) to service_role;

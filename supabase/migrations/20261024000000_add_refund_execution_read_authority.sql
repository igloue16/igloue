-- P3E4C2: service-only, read-only eligibility check for restricted refund execution.
-- Refund execution and final state remain owned by the Edge adapter and P3E4C1 RPC.

create function public.get_payment_refund_execution(p_refund_id uuid)
returns table (
    refund_id uuid,
    organisation_id uuid,
    provider text,
    refund_status text,
    refund_amount numeric,
    refund_currency text,
    payment_attempt_id uuid,
    payment_intent_id text,
    attempt_status text,
    attempt_amount numeric,
    attempt_currency text,
    attempt_paid_at timestamptz,
    attempt_refunded_at timestamptz,
    reservation_payment_status text,
    reservation_status text,
    exception_status text,
    exception_resolution text,
    source_provider_event_id uuid,
    source_event_matched_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
    v_refund public.payment_refunds%rowtype;
    v_reservation public.reservations%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_exception public.payment_exceptions%rowtype;
    v_event public.payment_provider_events%rowtype;
begin
    if p_refund_id is null then
        raise exception 'payment refund unavailable' using errcode = 'P0002';
    end if;

    select pr.* into v_refund
    from public.payment_refunds pr where pr.id = p_refund_id;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select r.* into v_reservation
    from public.reservations r
    where r.id = v_refund.reservation_id and r.organisation_id = v_refund.organisation_id
    for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select pa.* into v_attempt
    from public.payment_attempts pa
    where pa.id = v_refund.payment_attempt_id
      and pa.reservation_id = v_reservation.id
      and pa.organisation_id = v_reservation.organisation_id
    for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select e.* into v_exception
    from public.payment_exceptions e
    where e.id = v_refund.payment_exception_id
      and e.organisation_id = v_reservation.organisation_id
      and e.reservation_id = v_reservation.id
      and e.payment_attempt_id = v_attempt.id
    for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select pr.* into v_refund
    from public.payment_refunds pr
    where pr.id = p_refund_id
      and pr.organisation_id = v_reservation.organisation_id
      and pr.reservation_id = v_reservation.id
      and pr.payment_attempt_id = v_attempt.id
    for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select pe.* into v_event
    from public.payment_provider_events pe
    where pe.id = v_exception.source_provider_event_id
      and pe.organisation_id = v_attempt.organisation_id
      and pe.payment_attempt_id = v_attempt.id;
    if not found
       or v_refund.provider <> 'stripe'
       or v_refund.status <> 'prepared'
       or v_refund.provider_refund_id is not null
       or v_refund.amount <= 0
       or v_refund.currency <> 'EUR'
       or v_exception.status <> 'resolved'
       or v_exception.resolution <> 'refund_required'
       or v_attempt.provider <> 'stripe'
       or v_attempt.purpose <> 'rental'
       or v_attempt.status <> 'requires_review'
       or v_attempt.paid_at is null
       or v_attempt.refunded_at is not null
       or v_attempt.currency <> 'EUR'
       or v_attempt.amount <= 0
       or v_attempt.amount <> v_refund.amount
       or v_attempt.currency <> v_refund.currency
       or v_attempt.amount <> v_reservation.total_amount
       or v_reservation.payment_status <> 'requires_review'
       or v_refund.resolution_source <> v_exception.resolver_source
       or v_refund.resolution_actor <> v_exception.resolver_actor
       or v_event.provider <> 'stripe'
       or v_event.event_type <> 'checkout.session.completed'
       or v_event.status <> 'processed'
       or v_event.matched_at is null
       or v_event.conflict_detected_at is not null
       or v_event.payload_sha256 is null
       or v_event.payload_sha256 !~ '^[0-9a-f]{64}$'
       or v_event.livemode is null
       or v_attempt.provider_payment_intent_id is null
       or length(trim(v_attempt.provider_payment_intent_id)) not between 1 and 255 then
        raise exception 'payment refund is not executable' using errcode = 'P0001';
    end if;

    return query select
        v_refund.id, v_refund.organisation_id, v_refund.provider, v_refund.status,
        v_refund.amount, v_refund.currency, v_attempt.id,
        v_attempt.provider_payment_intent_id, v_attempt.status, v_attempt.amount,
        v_attempt.currency, v_attempt.paid_at, v_attempt.refunded_at,
        v_reservation.payment_status, v_reservation.status, v_exception.status,
        v_exception.resolution, v_event.id, v_event.matched_at;
end;
$$;

revoke all on function public.get_payment_refund_execution(uuid) from public, anon, authenticated;
grant execute on function public.get_payment_refund_execution(uuid) to service_role;

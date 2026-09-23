-- Trusted, database-side payment initiation boundary.
-- No external provider call, payment-status transition, or hold mutation occurs here.

create function public.initiate_reservation_payment(
    p_reservation_id uuid,
    p_capability_hash text,
    p_idempotency_key text
)
returns table (
    payment_attempt_id uuid,
    reservation_id uuid,
    organisation_id uuid,
    amount numeric,
    currency text,
    attempt_status text,
    hold_expires_at timestamptz,
    reused boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation public.reservations%rowtype;
    v_capability public.reservation_payment_capabilities%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_allocation_count integer := 0;
    v_held_allocation_count integer := 0;
    v_hold_expires_at timestamptz;
    v_key text;
begin
    if p_reservation_id is null then
        raise exception 'invalid payment initiation request'
            using errcode = '22023';
    end if;

    if p_capability_hash is null
       or p_capability_hash !~ '^\\\\x[0-9a-f]{64}$' then
        raise exception 'invalid payment initiation request'
            using errcode = '22023';
    end if;

    if p_idempotency_key is null
       or length(trim(p_idempotency_key)) not between 1 and 255
       or p_idempotency_key <> trim(p_idempotency_key) then
        raise exception 'invalid payment initiation request'
            using errcode = '22023';
    end if;
    v_key := trim(p_idempotency_key);

    select *
    into v_reservation
    from public.reservations as r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'payment initiation unavailable'
            using errcode = 'P0002';
    end if;

    if v_reservation.status <> 'pending' then
        raise exception 'reservation is not payable'
            using errcode = 'P0001';
    end if;

    if v_reservation.payment_status in ('paid', 'requires_review', 'refunded') then
        raise exception 'reservation is not payable'
            using errcode = 'P0001';
    end if;

    -- Lock all allocations in a stable order, matching the reservation-first
    -- lifecycle used by confirmation, cancellation and expiry.
    perform 1
    from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;

    select count(*)::integer,
           count(*) filter (where a.status = 'held')::integer
    into v_allocation_count, v_held_allocation_count
    from public.allocations as a
    where a.reservation_id = v_reservation.id;

    if v_allocation_count = 0 or v_held_allocation_count <> 1 then
        raise exception 'reservation hold is not payable'
            using errcode = 'P0001';
    end if;

    select a.hold_expires_at
    into v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = v_reservation.id
      and a.status = 'held'
    order by a.id
    limit 1;

    if v_hold_expires_at is null
       or v_hold_expires_at < now() + interval '10 minutes' then
        raise exception 'reservation hold is expiring'
            using errcode = 'P0001';
    end if;

    -- Lock and validate the capability after the reservation and allocation.
    select *
    into v_capability
    from public.reservation_payment_capabilities as c
    where c.reservation_id = v_reservation.id
    for update;

    if not found
       or v_capability.organisation_id <> v_reservation.organisation_id
       or v_capability.capability_hash <> lower(p_capability_hash)
       or v_capability.expires_at <= now()
       or v_capability.revoked_at is not null
       or v_capability.used_at is not null then
        raise exception 'payment capability is invalid'
            using errcode = 'P0001';
    end if;

    -- Lock all attempts for this reservation before deciding whether to reuse.
    perform 1
    from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
    order by pa.created_at, pa.id
    for update;

    select *
    into v_attempt
    from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
      and pa.status in ('created', 'checkout_open')
    order by pa.created_at, pa.id
    limit 1;

    if found then
        return query
        select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
               v_attempt.amount, v_attempt.currency, v_attempt.status,
               v_hold_expires_at, true;
        return;
    end if;

    select *
    into v_attempt
    from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
      and pa.idempotency_key = v_key;

    if found then
        if v_attempt.status = 'failed' then
            raise exception 'payment attempt already failed'
                using errcode = 'P0001';
        elsif v_attempt.status in ('paid', 'requires_review', 'refunded') then
            raise exception 'payment attempt is not reusable'
                using errcode = 'P0001';
        end if;
    end if;

    if v_reservation.payment_status = 'processing' then
        raise exception 'payment state is inconsistent'
            using errcode = 'P0001';
    end if;

    insert into public.payment_attempts (
        organisation_id,
        reservation_id,
        provider,
        purpose,
        amount,
        currency,
        status,
        idempotency_key
    )
    values (
        v_reservation.organisation_id,
        v_reservation.id,
        'stripe',
        'rental',
        v_reservation.total_amount,
        'EUR',
        'created',
        v_key
    )
    returning * into v_attempt;

    return query
    select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
           v_attempt.amount, v_attempt.currency, v_attempt.status,
           v_hold_expires_at, false;
end;
$$;

revoke all on function public.initiate_reservation_payment(uuid, text, text) from public;
revoke all on function public.initiate_reservation_payment(uuid, text, text) from anon, authenticated;
grant execute on function public.initiate_reservation_payment(uuid, text, text) to service_role;

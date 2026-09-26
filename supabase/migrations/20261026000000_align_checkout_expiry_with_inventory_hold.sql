-- P3E6A: reserve one server-authoritative Checkout window per payment attempt.
-- Stripe requires at least 30 minutes; inventory stays held five minutes longer.
alter table public.payment_attempts
    add column checkout_expires_at timestamptz;

create function public.prepare_reservation_payment_checkout(
    p_payment_attempt_id uuid,
    p_organisation_id uuid
)
returns table (
    payment_attempt_id uuid,
    reservation_id uuid,
    organisation_id uuid,
    amount numeric,
    currency text,
    attempt_status text,
    provider_checkout_session_id text,
    provider_checkout_url text,
    customer_email text,
    hold_expires_at timestamptz,
    checkout_expires_at timestamptz,
    eligible boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation public.reservations%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_capability public.reservation_payment_capabilities%rowtype;
    v_email text;
    v_item_count integer := 0;
    v_allocation_count integer := 0;
    v_held_count integer := 0;
    v_hold_expires_at timestamptz;
    v_checkout_expires_at timestamptz;
    v_now timestamptz;
    v_eligible boolean := false;
begin
    -- Follow the payment/lifecycle lock order and serialize all attempts for
    -- this reservation before taking allocation and attempt locks.
    select r.* into v_reservation
    from public.reservations as r
    join public.payment_attempts as pa
      on pa.reservation_id = r.id and pa.organisation_id = r.organisation_id
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id
    for update of r;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select count(*)::integer into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = v_reservation.id
      and ri.organisation_id = v_reservation.organisation_id;
    if v_item_count > 0 then
        perform 1 from public.reservation_items as ri
        where ri.reservation_id = v_reservation.id
        order by ri.product_id, ri.id for update;
    end if;

    perform 1 from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id for update;

    select * into v_capability
    from public.reservation_payment_capabilities as c
    where c.reservation_id = v_reservation.id
      and c.organisation_id = v_reservation.organisation_id
    for update;
    if not found or v_capability.revoked_at is not null
       or v_capability.used_at is not null then
        raise exception 'payment capability is unavailable' using errcode = 'P0001';
    end if;

    select * into v_attempt from public.payment_attempts as pa
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id
    for update;
    if not found or v_attempt.reservation_id <> v_reservation.id
       or v_attempt.organisation_id <> v_reservation.organisation_id then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select c.email into v_email from public.customers as c
    where c.id = v_reservation.customer_id
      and c.organisation_id = v_reservation.organisation_id;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    v_now := clock_timestamp();
    if v_reservation.status <> 'pending'
       or v_reservation.payment_status in ('paid', 'processing', 'requires_review', 'refunded')
       or v_attempt.status not in ('created', 'checkout_open') then
        return query select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
            v_attempt.amount, v_attempt.currency, v_attempt.status,
            v_attempt.provider_checkout_session_id, v_attempt.provider_checkout_url,
            v_email, null::timestamptz, v_attempt.checkout_expires_at, false;
        return;
    end if;

    if v_item_count > 0 then
        select b.hold_expires_at into v_hold_expires_at
        from public.validate_normalized_payment_basket(
            v_reservation.id, v_reservation.organisation_id, v_now
        ) as b;
    else
        select count(*)::integer,
               count(*) filter (where a.status = 'held')::integer,
               max(a.hold_expires_at) filter (where a.status = 'held')
        into v_allocation_count, v_held_count, v_hold_expires_at
        from public.allocations as a
        where a.reservation_id = v_reservation.id;
        if v_allocation_count <> 1 or v_held_count <> 1
           or v_hold_expires_at is null or v_hold_expires_at <= v_now then
            raise exception 'reservation hold is not payable' using errcode = 'P0001';
        end if;
    end if;

    if v_attempt.checkout_expires_at is null then
        -- Use one fixed window per attempt. A rounded-up epoch preserves the
        -- 31 minutes gives Stripe's 30-minute minimum a one-minute transport
        -- buffer, even when the DB timestamp has fractional seconds.
        v_checkout_expires_at := to_timestamp(ceil(extract(epoch from v_now))::bigint + 1860);
        if v_item_count > 0 then
            update public.allocations as a
            set hold_expires_at = v_checkout_expires_at + interval '5 minutes'
            where a.reservation_id = v_reservation.id and a.status = 'held';
        else
            update public.allocations as a
            set hold_expires_at = v_checkout_expires_at + interval '5 minutes'
            where a.reservation_id = v_reservation.id and a.status = 'held';
        end if;
        update public.payment_attempts as pa
        set checkout_expires_at = v_checkout_expires_at, updated_at = v_now
        where pa.id = v_attempt.id and pa.organisation_id = v_attempt.organisation_id;
        update public.reservation_payment_capabilities as c
        set expires_at = v_checkout_expires_at + interval '5 minutes'
        where c.id = v_capability.id and c.organisation_id = v_reservation.organisation_id;
        v_hold_expires_at := v_checkout_expires_at + interval '5 minutes';
    else
        v_checkout_expires_at := v_attempt.checkout_expires_at;
        if v_attempt.provider_checkout_session_id is not null then
            if v_item_count > 0 then
                select b.hold_expires_at into v_hold_expires_at
                from public.validate_normalized_payment_basket(
                    v_reservation.id, v_reservation.organisation_id, v_now
                ) as b;
            else
                select max(a.hold_expires_at) filter (where a.status = 'held')
                into v_hold_expires_at from public.allocations as a
                where a.reservation_id = v_reservation.id;
            end if;
        else
            -- Stripe may have created a session despite a timed-out response.
            -- Keep the exact same expiry and parameters on every retry.
            if v_item_count > 0 then
                select b.hold_expires_at into v_hold_expires_at
                from public.validate_normalized_payment_basket(
                    v_reservation.id, v_reservation.organisation_id, v_now
                ) as b;
            elsif v_allocation_count <> 1 or v_held_count <> 1
                  or v_hold_expires_at is null or v_hold_expires_at <= v_now then
                raise exception 'reservation hold is not payable' using errcode = 'P0001';
            end if;
            update public.allocations as a
            set hold_expires_at = v_checkout_expires_at + interval '5 minutes'
            where a.reservation_id = v_reservation.id and a.status = 'held';
            v_hold_expires_at := v_checkout_expires_at + interval '5 minutes';
        end if;
    end if;

    v_eligible := v_checkout_expires_at > v_now + interval '5 minutes'
        and v_hold_expires_at >= v_checkout_expires_at + interval '5 minutes'
        and v_hold_expires_at > v_now;

    return query select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
        v_attempt.amount, v_attempt.currency, v_attempt.status,
        v_attempt.provider_checkout_session_id, v_attempt.provider_checkout_url,
        v_email, v_hold_expires_at, v_checkout_expires_at, v_eligible;
end;
$$;

revoke all on function public.prepare_reservation_payment_checkout(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.prepare_reservation_payment_checkout(uuid, uuid)
to service_role;

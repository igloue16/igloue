-- MM3E2: validate normalized baskets at both Checkout database boundaries.

create function public.validate_normalized_basket(
    p_reservation_id uuid,
    p_organisation_id uuid,
    p_now timestamptz,
    p_minimum_hold interval
)
returns table (
    hold_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_item_count integer := 0;
    v_current_count integer := 0;
    v_linked_current_count integer := 0;
    v_distinct_item_count integer := 0;
    v_distinct_machine_count integer := 0;
    v_reference_start timestamptz;
    v_reference_end timestamptz;
    v_reference_expiry timestamptz;
begin
    if p_reservation_id is null
       or p_organisation_id is null
       or p_now is null
       or p_minimum_hold is null
       or p_minimum_hold < interval '0 minutes' then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    select count(*)::integer
    into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = p_reservation_id
      and ri.organisation_id = p_organisation_id;

    if v_item_count = 0 then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    select count(*)::integer,
           count(*) filter (where a.reservation_item_id is not null)::integer,
           count(distinct a.reservation_item_id)::integer,
           count(distinct a.machine_id)::integer
    into v_current_count,
         v_linked_current_count,
         v_distinct_item_count,
         v_distinct_machine_count
    from public.allocations as a
    where a.reservation_id = p_reservation_id
      and a.status in ('held', 'reserved', 'active');

    if v_current_count <> v_item_count
       or v_linked_current_count <> v_item_count
       or v_distinct_item_count <> v_item_count
       or v_distinct_machine_count <> v_item_count then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.reservation_items as ri
        where ri.reservation_id = p_reservation_id
          and ri.organisation_id <> p_organisation_id
    ) then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.allocations as a
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active')
          and (
              a.reservation_item_id is null
              or not exists (
                  select 1
                  from public.reservation_items as ri
                  where ri.id = a.reservation_item_id
                    and ri.reservation_id = a.reservation_id
                    and ri.organisation_id = p_organisation_id
              )
          )
    ) then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.reservation_items as ri
        left join public.allocations as a
          on a.reservation_item_id = ri.id
         and a.reservation_id = ri.reservation_id
         and a.status in ('held', 'reserved', 'active')
        where ri.reservation_id = p_reservation_id
          and ri.organisation_id = p_organisation_id
        group by ri.id
        having count(a.id) <> 1
    ) then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.allocations as a
        join public.reservation_items as ri
          on ri.id = a.reservation_item_id
         and ri.reservation_id = a.reservation_id
         and ri.organisation_id = p_organisation_id
        join public.physical_machines as pm
          on pm.id = a.machine_id
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active')
          and pm.product_id <> ri.product_id
    ) then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    select a.operational_start, a.operational_end, a.hold_expires_at
    into v_reference_start, v_reference_end, v_reference_expiry
    from public.allocations as a
    where a.reservation_id = p_reservation_id
      and a.status in ('held', 'reserved', 'active')
    order by a.id
    limit 1;

    if exists (
        select 1
        from public.allocations as a
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active')
          and (
              a.operational_start is distinct from v_reference_start
              or a.operational_end is distinct from v_reference_end
          )
    ) or v_reference_start >= v_reference_end then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.allocations as a
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active')
          and a.status <> 'held'
    ) then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    if v_reference_expiry is null
       or exists (
           select 1
           from public.allocations as a
           where a.reservation_id = p_reservation_id
             and a.status = 'held'
             and a.hold_expires_at is distinct from v_reference_expiry
       )
       or v_reference_expiry < p_now + p_minimum_hold then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    return query select v_reference_expiry;
end;
$$;

revoke all on function public.validate_normalized_basket(uuid, uuid, timestamptz, interval)
from public, anon, authenticated;
grant execute on function public.validate_normalized_basket(uuid, uuid, timestamptz, interval)
to service_role;

create or replace function public.validate_normalized_payment_basket(
    p_reservation_id uuid,
    p_organisation_id uuid,
    p_now timestamptz
)
returns table (
    hold_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
    return query
    select b.hold_expires_at
    from public.validate_normalized_basket(
        p_reservation_id,
        p_organisation_id,
        p_now,
        interval '10 minutes'
    ) as b;
end;
$$;

revoke all on function public.validate_normalized_payment_basket(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.validate_normalized_payment_basket(uuid, uuid, timestamptz)
to service_role;

create or replace function public.get_reservation_payment_checkout(
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
    provider_payment_intent_id text,
    customer_email text,
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
    v_email text;
    v_hold_expires_at timestamptz;
    v_item_count integer := 0;
    v_allocation_count integer := 0;
    v_held_allocation_count integer := 0;
    v_now timestamptz;
    v_eligible boolean := false;
begin
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

    select count(*)::integer
    into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = v_reservation.id
      and ri.organisation_id = v_reservation.organisation_id;

    if v_item_count > 0 then
        perform 1
        from public.reservation_items as ri
        where ri.reservation_id = v_reservation.id
        order by ri.product_id, ri.id
        for update;
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

    select c.email
    into v_email
    from public.customers as c
    where c.id = v_reservation.customer_id
      and c.organisation_id = v_reservation.organisation_id;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    v_now := now();

    if v_item_count > 0 then
        select b.hold_expires_at
        into v_hold_expires_at
        from public.validate_normalized_basket(
            v_reservation.id,
            v_reservation.organisation_id,
            v_now,
            interval '11 minutes'
        ) as b;
    else
        select count(*)::integer,
               count(*) filter (where a.status = 'held')::integer,
               max(a.hold_expires_at) filter (where a.status = 'held')
        into v_allocation_count, v_held_allocation_count, v_hold_expires_at
        from public.allocations as a
        where a.reservation_id = v_reservation.id;

        v_eligible := v_allocation_count > 0
            and v_held_allocation_count = 1
            and v_hold_expires_at is not null
            and v_hold_expires_at > v_now;
    end if;

    if v_item_count > 0 then
        v_eligible := v_attempt.status in ('created', 'checkout_open')
            and v_reservation.status = 'pending'
            and v_reservation.payment_status not in ('paid', 'processing', 'requires_review', 'refunded')
            and v_hold_expires_at >= v_now + interval '11 minutes';
    else
        v_eligible := v_eligible
            and v_attempt.status in ('created', 'checkout_open')
            and v_reservation.status = 'pending'
            and v_reservation.payment_status not in ('paid', 'processing', 'requires_review', 'refunded');
    end if;

    return query
    select v_attempt.id,
           v_reservation.id,
           v_reservation.organisation_id,
           v_attempt.amount,
           v_attempt.currency,
           v_attempt.status,
           v_attempt.provider_checkout_session_id,
           v_attempt.provider_checkout_url,
           v_attempt.provider_payment_intent_id,
           v_email,
           v_hold_expires_at,
           v_eligible;
end;
$$;

revoke all on function public.get_reservation_payment_checkout(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_reservation_payment_checkout(uuid, uuid)
to service_role;

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
    v_item_count integer := 0;
    v_hold_expires_at timestamptz;
    v_now timestamptz;
    v_eligible boolean := false;
begin
    if p_provider_checkout_session_id is null
       or length(trim(p_provider_checkout_session_id)) = 0
       or p_provider_checkout_url is null
       or length(trim(p_provider_checkout_url)) = 0 then
        raise exception 'invalid checkout state' using errcode = '22023';
    end if;

    -- Reservation -> normalized items -> allocations -> payment attempt.
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

    select count(*)::integer
    into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = v_reservation.id
      and ri.organisation_id = v_reservation.organisation_id;

    if v_item_count > 0 then
        perform 1
        from public.reservation_items as ri
        where ri.reservation_id = v_reservation.id
        order by ri.product_id, ri.id
        for update;
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

    if v_attempt.reservation_id <> v_reservation.id
       or v_attempt.organisation_id <> v_reservation.organisation_id then
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

    if v_attempt.status not in ('created', 'checkout_open') then
        raise exception 'payment attempt is not reusable' using errcode = 'P0001';
    end if;

    v_now := now();

    if v_item_count > 0 then
        select b.hold_expires_at
        into v_hold_expires_at
        from public.validate_normalized_basket(
            v_reservation.id,
            v_reservation.organisation_id,
            v_now,
            interval '0 minutes'
        ) as b;
    else
        select max(a.hold_expires_at) filter (where a.status = 'held')
        into v_hold_expires_at
        from public.allocations as a
        where a.reservation_id = v_reservation.id;
    end if;

    v_eligible := v_reservation.status = 'pending'
        and v_reservation.payment_status not in ('paid', 'processing', 'requires_review', 'refunded')
        and v_hold_expires_at is not null
        and v_hold_expires_at > v_now;

    if v_item_count = 0 then
        v_eligible := v_eligible
            and (select count(*) from public.allocations where reservation_id = v_reservation.id) > 0
            and (select count(*) from public.allocations where reservation_id = v_reservation.id and status = 'held') = 1;
    end if;

    if not v_eligible then
        raise exception 'payment window is closed' using errcode = 'P0001';
    end if;

    -- The previous implementation returned v_state.eligible; this local
    -- eligibility value is now authoritative after the post-Stripe locks.
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
           v_hold_expires_at,
           v_eligible;
end;
$$;

revoke all on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text)
to service_role;

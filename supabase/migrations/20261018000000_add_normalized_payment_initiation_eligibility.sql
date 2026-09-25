-- MM3E1: allow payment initiation for complete normalized baskets while
-- preserving legacy exact-one-allocation behavior.

create function public.validate_normalized_payment_basket(
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
       or p_now is null then
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
       or v_reference_expiry < p_now + interval '10 minutes' then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;

    return query select v_reference_expiry;
end;
$$;

revoke all on function public.validate_normalized_payment_basket(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.validate_normalized_payment_basket(uuid, uuid, timestamptz)
to service_role;

create or replace function public.initiate_reservation_payment(
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
    v_item_count integer := 0;
    v_hold_expires_at timestamptz;
    v_key text;
    v_now timestamptz;
    v_constraint text;
    v_message text;
begin
    if p_reservation_id is null then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;

    if p_capability_hash is null
       or p_capability_hash !~ '^\\x[0-9a-f]{64}$' then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;

    if p_idempotency_key is null
       or length(trim(p_idempotency_key)) not between 1 and 255
       or p_idempotency_key <> trim(p_idempotency_key) then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;
    v_key := trim(p_idempotency_key);

    -- Reservation is always the first lock for payment/lifecycle paths.
    select *
    into v_reservation
    from public.reservations as r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    if v_reservation.status <> 'pending'
       or v_reservation.payment_status in ('paid', 'requires_review', 'refunded') then
        raise exception 'reservation is not payable' using errcode = 'P0001';
    end if;

    -- The presence of reservation_items selects the normalized branch.
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

    -- Allocation locks follow expected-item locks on the normalized path.
    perform 1
    from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;

    -- Capture time only after the complete basket rows are locked.
    v_now := now();

    if v_item_count > 0 then
        select b.hold_expires_at
        into v_hold_expires_at
        from public.validate_normalized_payment_basket(
            v_reservation.id,
            v_reservation.organisation_id,
            v_now
        ) as b;
    else
        -- Preserve legacy exact-one-held-allocation semantics.
        select count(*)::integer,
               count(*) filter (where a.status = 'held')::integer
        into v_allocation_count, v_held_allocation_count
        from public.allocations as a
        where a.reservation_id = v_reservation.id;

        if v_allocation_count = 0 or v_held_allocation_count <> 1 then
            raise exception 'reservation hold is not payable' using errcode = 'P0001';
        end if;

        select a.hold_expires_at
        into v_hold_expires_at
        from public.allocations as a
        where a.reservation_id = v_reservation.id
          and a.status = 'held'
        order by a.id
        limit 1;

        if v_hold_expires_at is null
           or v_hold_expires_at < v_now + interval '10 minutes' then
            raise exception 'reservation hold is expiring' using errcode = 'P0001';
        end if;
    end if;

    -- Capability lock follows reservation, expected items, and allocations.
    select *
    into v_capability
    from public.reservation_payment_capabilities as c
    where c.reservation_id = v_reservation.id
    for update;

    if not found
       or v_capability.organisation_id <> v_reservation.organisation_id
       or v_capability.capability_hash <> lower(p_capability_hash)
       or v_capability.expires_at <= v_now
       or v_capability.revoked_at is not null
       or v_capability.used_at is not null then
        raise exception 'payment capability is invalid' using errcode = 'P0001';
    end if;

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
            raise exception 'payment attempt already failed' using errcode = 'P0001';
        elsif v_attempt.status in ('paid', 'requires_review', 'refunded') then
            raise exception 'payment attempt is not reusable' using errcode = 'P0001';
        end if;
    end if;

    if v_reservation.payment_status = 'processing' then
        raise exception 'payment state is inconsistent' using errcode = 'P0001';
    end if;

    begin
        insert into public.payment_attempts (
            organisation_id, reservation_id, provider, purpose,
            amount, currency, status, idempotency_key
        ) values (
            v_reservation.organisation_id, v_reservation.id, 'stripe', 'rental',
            v_reservation.total_amount, 'EUR', 'created', v_key
        ) returning * into v_attempt;
    exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name, v_message = message_text;
        if coalesce(v_constraint, '') <> 'payment_attempts_one_active_rental_idx'
           and v_message not like '%payment_attempts_one_active_rental_idx%' then
            raise;
        end if;

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

        if not found then
            raise;
        end if;

        return query
        select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
               v_attempt.amount, v_attempt.currency, v_attempt.status,
               v_hold_expires_at, true;
        return;
    end;

    return query
    select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
           v_attempt.amount, v_attempt.currency, v_attempt.status,
           v_hold_expires_at, false;
end;
$$;

revoke all on function public.initiate_reservation_payment(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.initiate_reservation_payment(uuid, text, text)
to service_role;

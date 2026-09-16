-- Atomically select an eligible physical machine and hold it
-- for a reservation's operational period.
--
-- The allocation exclusion constraint remains the final database
-- safeguard against overlapping blocking allocations.

create or replace function public.create_machine_hold(
    p_reservation_id uuid,
    p_operational_start timestamptz,
    p_operational_end timestamptz
)
returns table (
    allocation_id uuid,
    machine_id text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_product_id text;
    v_quantity integer;
    v_machine_id text;
    v_allocation_id uuid;
begin
    if p_operational_end <= p_operational_start then
        raise exception 'Operational end must be after operational start'
            using errcode = '22007';
    end if;

    select
        r.product_id,
        r.quantity
    into
        v_product_id,
        v_quantity
    from public.reservations r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found'
            using errcode = 'P0002';
    end if;

    -- V1 allocation supports one physical machine per reservation.
    -- Multi-unit reservations will be implemented separately.
    if v_quantity <> 1 then
        raise exception 'Machine hold currently supports quantity 1 only'
            using errcode = '22023';
    end if;

    -- If this reservation already has a blocking allocation,
    -- return it rather than creating another one.
    select
        a.id,
        a.machine_id
    into
        v_allocation_id,
        v_machine_id
    from public.allocations a
    where a.reservation_id = p_reservation_id
      and a.status in ('held', 'reserved', 'active')
    order by a.created_at
    limit 1;

    if found then
        return query
        select v_allocation_id, v_machine_id;
        return;
    end if;

    -- Lock one eligible machine row so concurrent transactions
    -- cannot select the same candidate at the same time.
    select pm.id
    into v_machine_id
    from public.physical_machines pm
    where pm.product_id = v_product_id
      and pm.active = true
      and pm.status = 'available'
      and (
          pm.unavailable_until is null
          or pm.unavailable_until <= p_operational_start
      )
      and not exists (
          select 1
          from public.allocations a
          where a.machine_id = pm.id
            and a.status in ('held', 'reserved', 'active')
            and tstzrange(
                a.operational_start,
                a.operational_end,
                '[)'
            ) && tstzrange(
                p_operational_start,
                p_operational_end,
                '[)'
            )
      )
    order by pm.id
    for update of pm skip locked
    limit 1;

    if v_machine_id is null then
        raise exception 'No eligible machine available'
            using errcode = 'P0001';
    end if;

    insert into public.allocations (
        reservation_id,
        machine_id,
        status,
        operational_start,
        operational_end
    )
    values (
        p_reservation_id,
        v_machine_id,
        'held',
        p_operational_start,
        p_operational_end
    )
    returning id into v_allocation_id;

    return query
    select v_allocation_id, v_machine_id;
end;
$$;

revoke all on function public.create_machine_hold(
    uuid,
    timestamptz,
    timestamptz
) from public;

grant execute on function public.create_machine_hold(
    uuid,
    timestamptz,
    timestamptz
) to service_role;
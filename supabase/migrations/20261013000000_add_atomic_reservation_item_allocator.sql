-- MM3B: allocate a complete reservation-item basket atomically.
-- This primitive does not create reservations or change lifecycle/payment state.

create index if not exists allocations_reservation_status_id_idx
    on public.allocations (reservation_id, status, id);

create index if not exists physical_machines_allocator_candidates_idx
    on public.physical_machines (product_id, id)
    where active = true and status = 'available';

create or replace function public.allocate_reservation_items(
    p_reservation_id uuid,
    p_operational_start timestamptz,
    p_operational_end timestamptz
)
returns table (
    allocation_id uuid,
    reservation_item_id uuid,
    machine_id text,
    hold_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation_organisation_id uuid;
    v_item public.reservation_items%rowtype;
    v_item_count integer;
    v_active_allocation_count integer;
    v_held_allocation_count integer;
    v_linked_allocation_count integer;
    v_distinct_item_count integer;
    v_distinct_machine_count integer;
    v_invalid_range_count integer;
    v_invalid_expiry_count integer;
    v_product_active boolean;
    v_machine_id text;
    v_allocation_id uuid;
    v_hold_expires_at timestamptz;
begin
    if p_reservation_id is null
       or p_operational_start is null
       or p_operational_end is null
       or p_operational_end <= p_operational_start then
        raise exception 'invalid reservation allocation request'
            using errcode = '22007';
    end if;

    -- Every allocator call serializes on the reservation first.
    select r.organisation_id
    into v_reservation_organisation_id
    from public.reservations as r
    where r.id = p_reservation_id
    for update;

    if not found or v_reservation_organisation_id is null then
        raise exception 'Reservation not found'
            using errcode = 'P0002';
    end if;

    select count(*)::integer
    into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = p_reservation_id
      and ri.organisation_id = v_reservation_organisation_id;

    if v_item_count = 0 then
        raise exception 'Reservation has no reservation items'
            using errcode = 'P0001';
    end if;

    -- MM3B is intentionally a fresh-basket primitive.  It never guesses
    -- whether an existing allocation is safe to reuse or relink.
    if exists (
        select 1
        from public.allocations as a
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active')
    ) or exists (
        select 1
        from public.allocations as a
        where a.reservation_id = p_reservation_id
          and a.reservation_item_id is not null
    ) then
        raise exception 'Reservation already has incompatible allocation state'
            using errcode = 'P0001';
    end if;

    -- Capture one expiry for the entire basket.
    v_hold_expires_at := now() + interval '30 minutes';

    -- Product groups, then items, are processed in stable order.  The
    -- authoritative expected set is the locked reservation_items relation.
    for v_item in
        select ri.*
        from public.reservation_items as ri
        where ri.reservation_id = p_reservation_id
          and ri.organisation_id = v_reservation_organisation_id
        order by ri.product_id, ri.id
        for update
    loop
        select p.active
        into v_product_active
        from public.products as p
        where p.id = v_item.product_id;

        if not found or not coalesce(v_product_active, false) then
            raise exception 'Requested product is inactive or missing'
                using errcode = 'P0001';
        end if;

        -- SKIP LOCKED permits fail-closed shortage under contention.  The
        -- allocation exclusion constraint remains the final race safeguard.
        select pm.id
        into v_machine_id
        from public.physical_machines as pm
        where pm.product_id = v_item.product_id
          and pm.active = true
          and pm.status = 'available'
          and (
              pm.unavailable_until is null
              or pm.unavailable_until <= p_operational_start
          )
          and not exists (
              select 1
              from public.allocations as a
              where a.machine_id = pm.id
                and a.status in ('held', 'reserved', 'active')
                and tstzrange(a.operational_start, a.operational_end, '[)')
                    && tstzrange(p_operational_start, p_operational_end, '[)')
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
            reservation_item_id,
            status,
            operational_start,
            operational_end,
            hold_expires_at
        )
        values (
            p_reservation_id,
            v_machine_id,
            v_item.id,
            'held',
            p_operational_start,
            p_operational_end,
            v_hold_expires_at
        )
        returning id into v_allocation_id;

        allocation_id := v_allocation_id;
        reservation_item_id := v_item.id;
        machine_id := v_machine_id;
        hold_expires_at := v_hold_expires_at;
        return next;
    end loop;

    -- Prove the complete newly-created set before successful return.
    select count(*)::integer,
           count(*) filter (where a.status = 'held')::integer,
           count(*) filter (where a.reservation_item_id is not null)::integer,
           count(distinct a.reservation_item_id)::integer,
           count(distinct a.machine_id)::integer,
           count(*) filter (
               where a.operational_start <> p_operational_start
                  or a.operational_end <> p_operational_end
           )::integer,
           count(*) filter (
               where a.hold_expires_at is distinct from v_hold_expires_at
           )::integer
    into v_active_allocation_count,
         v_held_allocation_count,
         v_linked_allocation_count,
         v_distinct_item_count,
         v_distinct_machine_count,
         v_invalid_range_count,
         v_invalid_expiry_count
    from public.allocations as a
    where a.reservation_id = p_reservation_id
      and a.status in ('held', 'reserved', 'active');

    if v_active_allocation_count <> v_item_count
       or v_held_allocation_count <> v_item_count
       or v_linked_allocation_count <> v_item_count
       or v_distinct_item_count <> v_item_count
       or v_distinct_machine_count <> v_item_count
       or v_invalid_range_count <> 0
       or v_invalid_expiry_count <> 0 then
        raise exception 'Incomplete reservation allocation set'
            using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.reservation_items as ri
        left join public.allocations as a
          on a.reservation_item_id = ri.id
         and a.reservation_id = ri.reservation_id
         and a.status = 'held'
        where ri.reservation_id = p_reservation_id
          and ri.organisation_id = v_reservation_organisation_id
        group by ri.id
        having count(a.id) <> 1
    ) then
        raise exception 'Reservation item allocation set is incomplete'
            using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from public.allocations as a
        join public.reservation_items as ri
          on ri.id = a.reservation_item_id
         and ri.reservation_id = a.reservation_id
        join public.physical_machines as pm
          on pm.id = a.machine_id
        where a.reservation_id = p_reservation_id
          and a.status = 'held'
          and pm.product_id <> ri.product_id
    ) then
        raise exception 'Reservation allocation product mismatch'
            using errcode = 'P0001';
    end if;
end;
$$;

revoke all on function public.allocate_reservation_items(uuid, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.allocate_reservation_items(uuid, timestamptz, timestamptz)
to service_role;

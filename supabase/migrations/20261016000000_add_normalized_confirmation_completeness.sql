-- MM3D1: fail-closed confirmation for normalized reservation baskets.
-- Legacy reservations without reservation_items retain the existing contract.

create or replace function public.confirm_reservation(p_reservation_id uuid)
returns table (
    reservation_id uuid,
    reservation_status text,
    allocation_ids uuid[],
    allocation_statuses text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_status text;
    v_organisation_id uuid;
    v_ids uuid[];
    v_statuses text[];
    v_item_count integer := 0;
    v_current_count integer := 0;
    v_linked_current_count integer := 0;
    v_distinct_item_count integer := 0;
    v_distinct_machine_count integer := 0;
    v_reference_start timestamptz;
    v_reference_end timestamptz;
    v_reference_expiry timestamptz;
    v_now timestamptz;
    v_normalized boolean := false;
begin
    select r.status, r.organisation_id
    into v_status, v_organisation_id
    from public.reservations as r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found' using errcode = 'P0002';
    end if;

    if v_status <> 'confirmed' and v_status <> 'pending' then
        raise exception 'Reservation cannot be confirmed from status %', v_status
            using errcode = 'P0001';
    end if;

    select count(*)::integer
    into v_item_count
    from public.reservation_items as ri
    where ri.reservation_id = p_reservation_id;

    v_normalized := v_item_count > 0;

    if v_normalized then
        if exists (
            select 1
            from public.reservation_items as ri
            where ri.reservation_id = p_reservation_id
              and ri.organisation_id is distinct from v_organisation_id
        ) then
            raise exception 'Reservation item organisation mismatch'
                using errcode = 'P0001';
        end if;

        -- Normalized confirmation locks the authoritative expected set before
        -- the allocation set, both in deterministic order.
        perform 1
        from public.reservation_items as ri
        where ri.reservation_id = p_reservation_id
        order by ri.product_id, ri.id
        for update;
    end if;

    -- Capture allocations after reservation_items have been locked.  The
    -- deterministic order prevents avoidable row-lock inversions.
    perform 1
    from public.allocations as a
    where a.reservation_id = p_reservation_id
    order by a.id
    for update;

    if not v_normalized then
        -- Preserve the historical single-allocation/legacy contract.
        if v_status = 'pending' then
            if not exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status = 'held'
            ) then
                raise exception 'Reservation has no held allocation'
                    using errcode = 'P0001';
            end if;

            if exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status = 'held'
                  and (a.hold_expires_at is null or a.hold_expires_at <= now())
            ) then
                raise exception 'Reservation hold has expired' using errcode = 'P0001';
            end if;

            update public.allocations as a
            set status = 'reserved', hold_expires_at = null
            where a.reservation_id = p_reservation_id
              and a.status = 'held';

            update public.reservations as r
            set status = 'confirmed'
            where r.id = p_reservation_id;
        end if;
    else
        -- One database timestamp is authoritative for every expiry comparison.
        v_now := clock_timestamp();

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

        if v_item_count = 0
           or v_current_count <> v_item_count
           or v_linked_current_count <> v_item_count
           or v_distinct_item_count <> v_item_count
           or v_distinct_machine_count <> v_item_count then
            raise exception 'Incomplete normalized reservation allocation set'
                using errcode = 'P0001';
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
                        and ri.organisation_id = v_organisation_id
                  )
              )
        ) then
            raise exception 'Invalid normalized reservation item linkage'
                using errcode = 'P0001';
        end if;

        if exists (
            select 1
            from public.reservation_items as ri
            left join public.allocations as a
              on a.reservation_item_id = ri.id
             and a.reservation_id = ri.reservation_id
             and a.status in ('held', 'reserved', 'active')
            where ri.reservation_id = p_reservation_id
            group by ri.id
            having count(a.id) <> 1
        ) then
            raise exception 'Normalized reservation item representation is incomplete'
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
              and a.status in ('held', 'reserved', 'active')
              and pm.product_id <> ri.product_id
        ) then
            raise exception 'Normalized reservation allocation product mismatch'
                using errcode = 'P0001';
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
            raise exception 'Normalized reservation operational range is incoherent'
                using errcode = 'P0001';
        end if;

        if v_status = 'pending' then
            if exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status in ('held', 'reserved', 'active')
                  and a.status <> 'held'
            ) then
                raise exception 'Normalized reservation has non-held current allocation'
                    using errcode = 'P0001';
            end if;

            if exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status = 'held'
                  and (a.hold_expires_at is null or a.hold_expires_at <= v_now)
            ) then
                raise exception 'Normalized reservation hold has expired'
                    using errcode = 'P0001';
            end if;

            if exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status = 'held'
                  and a.hold_expires_at is distinct from v_reference_expiry
            ) or v_reference_expiry is null then
                raise exception 'Normalized reservation hold expiry is incoherent'
                    using errcode = 'P0001';
            end if;

            update public.allocations as a
            set status = 'reserved', hold_expires_at = null
            where a.reservation_id = p_reservation_id
              and a.status = 'held';

            update public.reservations as r
            set status = 'confirmed'
            where r.id = p_reservation_id;
        else
            if exists (
                select 1
                from public.allocations as a
                where a.reservation_id = p_reservation_id
                  and a.status in ('held', 'reserved', 'active')
                  and (a.status = 'held' or a.hold_expires_at is not null)
            ) then
                raise exception 'Confirmed normalized reservation is incoherent'
                    using errcode = 'P0001';
            end if;
        end if;
    end if;

    insert into public.outbox_events (
        organisation_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    )
    values (
        v_organisation_id,
        'reservation.confirmed',
        'reservation',
        p_reservation_id,
        '{}'::jsonb
    )
    on conflict (organisation_id, event_type, aggregate_type, aggregate_id)
    do nothing;

    select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]),
           coalesce(array_agg(a.status order by a.id), '{}'::text[])
    into v_ids, v_statuses
    from public.allocations as a
    where a.reservation_id = p_reservation_id;

    return query
    select p_reservation_id, 'confirmed'::text, v_ids, v_statuses;
end;
$$;

revoke all on function public.confirm_reservation(uuid) from public;
revoke all on function public.confirm_reservation(uuid) from anon, authenticated;
grant execute on function public.confirm_reservation(uuid) to service_role;

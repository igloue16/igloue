-- MM3D2: fail-closed expiry for normalized reservation baskets.
-- Legacy reservations without reservation_items retain the existing contract.

create or replace function public.expire_reservation_hold(p_reservation_id uuid)
returns table (
    reservation_id uuid,
    reservation_status text,
    allocation_ids uuid[],
    allocation_statuses text[],
    service_job_ids uuid[],
    service_job_statuses text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_status text;
    v_organisation_id uuid;
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
    v_allocation_ids uuid[];
    v_allocation_statuses text[];
    v_service_job_ids uuid[];
    v_service_job_statuses text[];
begin
    select r.status, r.organisation_id
    into v_status, v_organisation_id
    from public.reservations as r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found' using errcode = 'P0002';
    end if;

    if v_status in ('confirmed', 'ongoing', 'completed') then
        raise exception 'Reservation cannot be expired from status %', v_status
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

        -- Match MM3D1 and the allocator: reservation, expected items, then
        -- allocations, all in deterministic order.
        perform 1
        from public.reservation_items as ri
        where ri.reservation_id = p_reservation_id
        order by ri.product_id, ri.id
        for update;
    end if;

    perform 1
    from public.allocations as a
    where a.reservation_id = p_reservation_id
    order by a.id
    for update;

    perform 1
    from public.service_jobs as j
    where j.reservation_id = p_reservation_id
    order by j.id
    for update;

    -- A cancelled reservation is an idempotent historical result.  Do not
    -- revalidate or mutate its historical allocation basket.
    if v_status <> 'pending' then
        select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]),
               coalesce(array_agg(a.status order by a.id), '{}'::text[])
        into v_allocation_ids, v_allocation_statuses
        from public.allocations as a
        where a.reservation_id = p_reservation_id;

        select coalesce(array_agg(j.id order by j.id), '{}'::uuid[]),
               coalesce(array_agg(j.status order by j.id), '{}'::text[])
        into v_service_job_ids, v_service_job_statuses
        from public.service_jobs as j
        where j.reservation_id = p_reservation_id;

        return query
        select p_reservation_id, 'cancelled'::text,
            v_allocation_ids, v_allocation_statuses,
            v_service_job_ids, v_service_job_statuses;
        return;
    end if;

    if not v_normalized then
        -- Preserve the historical legacy expiry behavior.
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
              and (a.hold_expires_at is null or a.hold_expires_at > now())
        ) then
            raise exception 'Reservation hold has not expired'
                using errcode = 'P0001';
        end if;

        if exists (
            select 1
            from public.service_jobs as j
            where j.reservation_id = p_reservation_id
              and j.status = 'in_progress'
        ) then
            raise exception 'Reservation hold cannot expire while a service job is in progress'
                using errcode = 'P0001';
        end if;

        update public.allocations as a
        set status = 'released', released_at = now(), hold_expires_at = null
        where a.reservation_id = p_reservation_id
          and a.status = 'held';

        update public.service_jobs as j
        set status = 'cancelled'
        where j.reservation_id = p_reservation_id
          and j.status in ('scheduled', 'assigned');

        update public.reservations as r
        set status = 'cancelled'
        where r.id = p_reservation_id;
    else
        -- One authoritative timestamp is used for every normalized expiry
        -- comparison after all required rows have been locked.
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

        if v_reference_expiry is null
           or exists (
               select 1
               from public.allocations as a
               where a.reservation_id = p_reservation_id
                 and a.status = 'held'
                 and a.hold_expires_at is distinct from v_reference_expiry
           ) then
            raise exception 'Normalized reservation hold expiry is incoherent'
                using errcode = 'P0001';
        end if;

        if v_reference_expiry > v_now then
            raise exception 'Reservation hold has not expired'
                using errcode = 'P0001';
        end if;

        if exists (
            select 1
            from public.service_jobs as j
            where j.reservation_id = p_reservation_id
              and j.status = 'in_progress'
        ) then
            raise exception 'Reservation hold cannot expire while a service job is in progress'
                using errcode = 'P0001';
        end if;

        update public.allocations as a
        set status = 'released', released_at = now(), hold_expires_at = null
        where a.reservation_id = p_reservation_id
          and a.status = 'held';

        update public.service_jobs as j
        set status = 'cancelled'
        where j.reservation_id = p_reservation_id
          and j.status in ('scheduled', 'assigned');

        update public.reservations as r
        set status = 'cancelled'
        where r.id = p_reservation_id;
    end if;

    select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]),
           coalesce(array_agg(a.status order by a.id), '{}'::text[])
    into v_allocation_ids, v_allocation_statuses
    from public.allocations as a
    where a.reservation_id = p_reservation_id;

    select coalesce(array_agg(j.id order by j.id), '{}'::uuid[]),
           coalesce(array_agg(j.status order by j.id), '{}'::text[])
    into v_service_job_ids, v_service_job_statuses
    from public.service_jobs as j
    where j.reservation_id = p_reservation_id;

    return query
    select p_reservation_id, 'cancelled'::text,
        v_allocation_ids, v_allocation_statuses,
        v_service_job_ids, v_service_job_statuses;
end;
$$;

revoke all on function public.expire_reservation_hold(uuid) from public;
revoke all on function public.expire_reservation_hold(uuid) from anon, authenticated;
grant execute on function public.expire_reservation_hold(uuid) to service_role;

create or replace function public.cleanup_expired_reservation_holds(
    p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation_id uuid;
    v_expired_count integer := 0;
begin
    if p_limit is null or p_limit <= 0 then
        raise exception 'Cleanup limit must be positive' using errcode = '22023';
    end if;

    -- Candidate selection remains conservative and delegates the complete
    -- normalized predicate to expire_reservation_hold.  Intentional P0001
    -- lifecycle rejections are isolated per candidate; unexpected database
    -- or infrastructure errors still abort the batch.
    for v_reservation_id in
        select r.id
        from public.reservations as r
        where r.status = 'pending'
          and exists (
              select 1
              from public.allocations as a
              where a.reservation_id = r.id
                and a.status = 'held'
                and a.hold_expires_at is not null
                and a.hold_expires_at <= now()
          )
          and not exists (
              select 1
              from public.allocations as a
              where a.reservation_id = r.id
                and a.status = 'held'
                and (a.hold_expires_at is null or a.hold_expires_at > now())
          )
        order by r.created_at, r.id
        limit p_limit
        for update of r skip locked
    loop
        begin
            perform 1 from public.expire_reservation_hold(v_reservation_id);
            v_expired_count := v_expired_count + 1;
        exception
            when sqlstate 'P0001' then
                -- Malformed or otherwise ineligible lifecycle candidates are
                -- intentionally skipped; the next candidate can proceed.
                null;
        end;
    end loop;

    return v_expired_count;
end;
$$;

revoke all on function public.cleanup_expired_reservation_holds(integer) from public;
revoke all on function public.cleanup_expired_reservation_holds(integer) from anon, authenticated;
grant execute on function public.cleanup_expired_reservation_holds(integer) to service_role;

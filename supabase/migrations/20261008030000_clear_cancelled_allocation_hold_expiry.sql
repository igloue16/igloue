-- Keep released allocations free of stale hold-expiry metadata.

create or replace function public.cancel_reservation(p_reservation_id uuid)
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
    v_reservation public.reservations%rowtype;
    v_allocation_ids uuid[];
    v_allocation_statuses text[];
    v_service_job_ids uuid[];
    v_service_job_statuses text[];
begin
    select *
    into v_reservation
    from public.reservations
    where id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found'
            using errcode = 'P0002';
    end if;

    if v_reservation.status not in ('pending', 'confirmed', 'cancelled') then
        raise exception 'Reservation cannot be cancelled from status %', v_reservation.status
            using errcode = 'P0001';
    end if;

    -- Lock allocations before service jobs and keep the same order on every path.
    perform 1
    from public.allocations as a
    where a.reservation_id = p_reservation_id
    for update;

    perform 1
    from public.service_jobs as j
    where j.reservation_id = p_reservation_id
    for update;

    if v_reservation.status <> 'cancelled'
       and exists (
           select 1 from public.service_jobs as j
           where j.reservation_id = p_reservation_id
             and j.status = 'in_progress'
       ) then
        raise exception 'Reservation cannot be cancelled while a service job is in progress'
            using errcode = 'P0001';
    end if;

    if v_reservation.status <> 'cancelled' then
        update public.allocations as a
        set status = 'released',
            released_at = now(),
            hold_expires_at = null
        where a.reservation_id = p_reservation_id
          and a.status in ('held', 'reserved', 'active');

        update public.service_jobs as j
        set status = 'cancelled'
        where j.reservation_id = p_reservation_id
          and j.status in ('scheduled', 'assigned');

        update public.reservations
        set status = 'cancelled'
        where id = p_reservation_id;
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
    select p_reservation_id,
           'cancelled'::text,
           v_allocation_ids,
           v_allocation_statuses,
           v_service_job_ids,
           v_service_job_statuses;
end;
$$;

revoke all on function public.cancel_reservation(uuid) from public;
revoke all on function public.cancel_reservation(uuid) from anon, authenticated;
grant execute on function public.cancel_reservation(uuid) to service_role;

-- V1 reservation hold lifecycle: pending/held, confirmed/reserved, expiry.
-- Initial checkout holds expire after a fixed 30-minute window.

alter table public.allocations
    add column hold_expires_at timestamptz;

-- Preserve the existing create_machine_hold contract while recording a finite
-- expiry only when a new held allocation is created. Existing allocations are
-- returned unchanged on idempotent retries.
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

    select r.product_id, r.quantity
    into v_product_id, v_quantity
    from public.reservations r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found' using errcode = 'P0002';
    end if;

    if v_quantity <> 1 then
        raise exception 'Machine hold currently supports quantity 1 only'
            using errcode = '22023';
    end if;

    select a.id, a.machine_id
    into v_allocation_id, v_machine_id
    from public.allocations a
    where a.reservation_id = p_reservation_id
      and a.status in ('held', 'reserved', 'active')
    order by a.created_at
    limit 1;

    if found then
        return query select v_allocation_id, v_machine_id;
        return;
    end if;

    select pm.id
    into v_machine_id
    from public.physical_machines pm
    where pm.product_id = v_product_id
      and pm.active = true
      and pm.status = 'available'
      and (pm.unavailable_until is null or pm.unavailable_until <= p_operational_start)
      and not exists (
          select 1
          from public.allocations a
          where a.machine_id = pm.id
            and a.status in ('held', 'reserved', 'active')
            and tstzrange(a.operational_start, a.operational_end, '[)')
                && tstzrange(p_operational_start, p_operational_end, '[)')
      )
    order by pm.id
    for update of pm skip locked
    limit 1;

    if v_machine_id is null then
        raise exception 'No eligible machine available' using errcode = 'P0001';
    end if;

    insert into public.allocations (
        reservation_id, machine_id, status, operational_start,
        operational_end, hold_expires_at
    )
    values (
        p_reservation_id, v_machine_id, 'held', p_operational_start,
        p_operational_end, now() + interval '30 minutes'
    )
    returning id into v_allocation_id;

    return query select v_allocation_id, v_machine_id;
end;
$$;

revoke all on function public.create_machine_hold(uuid, timestamptz, timestamptz) from public;
grant execute on function public.create_machine_hold(uuid, timestamptz, timestamptz) to service_role;

-- Confirm a pending reservation while its held allocation is still valid.
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
    v_ids uuid[];
    v_statuses text[];
begin
    select r.status into v_status
    from public.reservations r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found' using errcode = 'P0002';
    end if;

    if v_status <> 'confirmed' and v_status <> 'pending' then
        raise exception 'Reservation cannot be confirmed from status %', v_status
            using errcode = 'P0001';
    end if;

    if v_status = 'pending' then
        perform 1 from public.allocations a
        where a.reservation_id = p_reservation_id
        for update;

        if not exists (
            select 1 from public.allocations a
            where a.reservation_id = p_reservation_id and a.status = 'held'
        ) then
            raise exception 'Reservation has no held allocation' using errcode = 'P0001';
        end if;

        if exists (
            select 1 from public.allocations a
            where a.reservation_id = p_reservation_id
              and a.status = 'held'
              and (a.hold_expires_at is null or a.hold_expires_at <= now())
        ) then
            raise exception 'Reservation hold has expired' using errcode = 'P0001';
        end if;

        update public.allocations a
        set status = 'reserved', hold_expires_at = null
        where a.reservation_id = p_reservation_id and a.status = 'held';

        update public.reservations r
        set status = 'confirmed'
        where r.id = p_reservation_id;
    end if;

    select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]),
           coalesce(array_agg(a.status order by a.id), '{}'::text[])
    into v_ids, v_statuses
    from public.allocations a
    where a.reservation_id = p_reservation_id;

    return query select p_reservation_id, 'confirmed'::text, v_ids, v_statuses;
end;
$$;

revoke all on function public.confirm_reservation(uuid) from public;
revoke all on function public.confirm_reservation(uuid) from anon, authenticated;
grant execute on function public.confirm_reservation(uuid) to service_role;

-- Expire only a genuinely stale pending hold. Cancellation/expiry races are
-- serialized by the reservation row lock acquired first.
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
    v_allocation_ids uuid[];
    v_allocation_statuses text[];
    v_service_job_ids uuid[];
    v_service_job_statuses text[];
begin
    select r.status into v_status
    from public.reservations r
    where r.id = p_reservation_id
    for update;

    if not found then
        raise exception 'Reservation not found' using errcode = 'P0002';
    end if;

    if v_status in ('confirmed', 'ongoing', 'completed') then
        raise exception 'Reservation cannot be expired from status %', v_status
            using errcode = 'P0001';
    end if;

    perform 1 from public.allocations a
    where a.reservation_id = p_reservation_id
    for update;
    perform 1 from public.service_jobs j
    where j.reservation_id = p_reservation_id
    for update;

    if v_status = 'pending' then
        if not exists (
            select 1 from public.allocations a
            where a.reservation_id = p_reservation_id and a.status = 'held'
        ) then
            raise exception 'Reservation has no held allocation' using errcode = 'P0001';
        end if;
        if exists (
            select 1 from public.allocations a
            where a.reservation_id = p_reservation_id
              and a.status = 'held'
              and (a.hold_expires_at is null or a.hold_expires_at > now())
        ) then
            raise exception 'Reservation hold has not expired' using errcode = 'P0001';
        end if;
        if exists (
            select 1 from public.service_jobs j
            where j.reservation_id = p_reservation_id and j.status = 'in_progress'
        ) then
            raise exception 'Reservation hold cannot expire while a service job is in progress'
                using errcode = 'P0001';
        end if;

        update public.allocations a
        set status = 'released', released_at = now(), hold_expires_at = null
        where a.reservation_id = p_reservation_id and a.status = 'held';

        update public.service_jobs j
        set status = 'cancelled'
        where j.reservation_id = p_reservation_id
          and j.status in ('scheduled', 'assigned');

        update public.reservations r
        set status = 'cancelled'
        where r.id = p_reservation_id;
    end if;

    select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]),
           coalesce(array_agg(a.status order by a.id), '{}'::text[])
    into v_allocation_ids, v_allocation_statuses
    from public.allocations a where a.reservation_id = p_reservation_id;

    select coalesce(array_agg(j.id order by j.id), '{}'::uuid[]),
           coalesce(array_agg(j.status order by j.id), '{}'::text[])
    into v_service_job_ids, v_service_job_statuses
    from public.service_jobs j where j.reservation_id = p_reservation_id;

    return query select p_reservation_id, 'cancelled'::text,
        v_allocation_ids, v_allocation_statuses,
        v_service_job_ids, v_service_job_statuses;
end;
$$;

revoke all on function public.expire_reservation_hold(uuid) from public;
revoke all on function public.expire_reservation_hold(uuid) from anon, authenticated;
grant execute on function public.expire_reservation_hold(uuid) to service_role;

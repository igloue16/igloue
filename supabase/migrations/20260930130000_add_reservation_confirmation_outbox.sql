-- Atomically enqueue the reservation.confirmed business event with confirmation.
-- The event payload remains empty; the worker loads authoritative data.

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
begin
    select r.status, r.organisation_id
    into v_status, v_organisation_id
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
    from public.allocations a
    where a.reservation_id = p_reservation_id;

    return query select p_reservation_id, 'confirmed'::text, v_ids, v_statuses;
end;
$$;

revoke all on function public.confirm_reservation(uuid) from public;
revoke all on function public.confirm_reservation(uuid) from anon, authenticated;
grant execute on function public.confirm_reservation(uuid) to service_role;

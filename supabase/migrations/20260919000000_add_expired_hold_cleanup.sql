-- Backend-only batch primitive for processing genuinely expired holds.
-- The single-reservation lifecycle remains centralized in expire_reservation_hold.

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

    -- Lock reservations first, matching confirmation, cancellation and expiry.
    -- Only reservations whose held allocations are all expired are selected;
    -- an ambiguous mixed state is left for explicit operational handling.
    for v_reservation_id in
        select r.id
        from public.reservations r
        where r.status = 'pending'
          and exists (
              select 1
              from public.allocations a
              where a.reservation_id = r.id
                and a.status = 'held'
                and a.hold_expires_at is not null
                and a.hold_expires_at <= now()
          )
          and not exists (
              select 1
              from public.allocations a
              where a.reservation_id = r.id
                and a.status = 'held'
                and (a.hold_expires_at is null or a.hold_expires_at > now())
          )
        order by r.created_at, r.id
        limit p_limit
        for update of r skip locked
    loop
        -- Reuse the existing single-reservation primitive so all allocation,
        -- service-job, idempotency and state rules remain in one place.
        perform 1 from public.expire_reservation_hold(v_reservation_id);
        v_expired_count := v_expired_count + 1;
    end loop;

    return v_expired_count;
end;
$$;

revoke all on function public.cleanup_expired_reservation_holds(integer) from public;
revoke all on function public.cleanup_expired_reservation_holds(integer) from anon, authenticated;
grant execute on function public.cleanup_expired_reservation_holds(integer) to service_role;


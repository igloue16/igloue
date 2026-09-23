-- Atomically claim a bounded batch of pending transactional outbox events.
-- This primitive intentionally does not implement retries, leases or recovery.

create or replace function public.claim_outbox_events(p_limit integer)
returns table (
    id uuid,
    organisation_id uuid,
    event_type text,
    aggregate_type text,
    aggregate_id uuid,
    payload jsonb,
    status text,
    attempt_count integer,
    last_attempt_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception 'claim limit must be between 1 and 100'
            using errcode = '22023';
    end if;

    return query
    with candidates as (
        select e.id
        from public.outbox_events as e
        where e.status = 'pending'
          and e.available_at <= now()
        order by e.available_at asc, e.created_at asc, e.id asc
        for update skip locked
        limit p_limit
    ), claimed as (
        update public.outbox_events as e
        set status = 'processing',
            last_attempt_at = now(),
            attempt_count = e.attempt_count + 1
        from candidates as c
        where e.id = c.id
        returning e.id, e.organisation_id, e.event_type,
            e.aggregate_type, e.aggregate_id, e.payload, e.status,
            e.attempt_count, e.last_attempt_at, e.available_at,
            e.created_at
    )
    select c.id, c.organisation_id, c.event_type, c.aggregate_type,
        c.aggregate_id, c.payload, c.status, c.attempt_count,
        c.last_attempt_at
    from claimed as c
    order by c.available_at asc, c.created_at asc, c.id asc;
end;
$$;

revoke all on function public.claim_outbox_events(integer) from public;
revoke all on function public.claim_outbox_events(integer) from anon, authenticated;
grant execute on function public.claim_outbox_events(integer) to service_role;

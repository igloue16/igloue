-- Add explicit processing leases and database-generated claim tokens.
-- Legacy processing rows are returned to pending so the new invariant is safe.

alter table public.outbox_events
    add column lease_expires_at timestamptz,
    add column claim_token uuid;

-- The previous claim primitive had no lease/token columns. Preserve those
-- events and make them claimable again rather than silently dropping them.
update public.outbox_events
set status = 'pending',
    available_at = now(),
    lease_expires_at = null,
    claim_token = null
where status = 'processing';

update public.outbox_events
set lease_expires_at = null,
    claim_token = null
where status <> 'processing';

alter table public.outbox_events
    add constraint outbox_events_processing_lease_check
    check (
        (status = 'processing'
            and lease_expires_at is not null
            and claim_token is not null)
        or
        (status <> 'processing'
            and lease_expires_at is null
            and claim_token is null)
    );

drop function public.claim_outbox_events(integer);

create function public.claim_outbox_events(p_limit integer)
returns table (
    id uuid,
    organisation_id uuid,
    event_type text,
    aggregate_type text,
    aggregate_id uuid,
    payload jsonb,
    status text,
    attempt_count integer,
    last_attempt_at timestamptz,
    lease_expires_at timestamptz,
    claim_token uuid
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
            attempt_count = e.attempt_count + 1,
            lease_expires_at = now() + interval '15 minutes',
            claim_token = pg_catalog.gen_random_uuid()
        from candidates as c
        where e.id = c.id
        returning e.id, e.organisation_id, e.event_type,
            e.aggregate_type, e.aggregate_id, e.payload, e.status,
            e.attempt_count, e.last_attempt_at, e.lease_expires_at,
            e.claim_token, e.available_at, e.created_at
    )
    select c.id, c.organisation_id, c.event_type, c.aggregate_type,
        c.aggregate_id, c.payload, c.status, c.attempt_count,
        c.last_attempt_at, c.lease_expires_at, c.claim_token
    from claimed as c
    order by c.available_at asc, c.created_at asc, c.id asc;
end;
$$;

revoke all on function public.claim_outbox_events(integer) from public;
revoke all on function public.claim_outbox_events(integer) from anon, authenticated;
grant execute on function public.claim_outbox_events(integer) to service_role;

create function public.recover_stale_outbox_events(p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_recovered_count integer;
begin
    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception 'recovery limit must be between 1 and 100'
            using errcode = '22023';
    end if;

    with candidates as (
        select e.id
        from public.outbox_events as e
        where e.status = 'processing'
          and e.lease_expires_at is not null
          and e.lease_expires_at <= now()
        order by e.lease_expires_at asc, e.last_attempt_at asc,
            e.created_at asc, e.id asc
        for update skip locked
        limit p_limit
    ), recovered as (
        update public.outbox_events as e
        set status = 'pending',
            available_at = now(),
            lease_expires_at = null,
            claim_token = null
        from candidates as c
        where e.id = c.id
        returning e.id
    )
    select count(*)::integer into v_recovered_count
    from recovered;

    return v_recovered_count;
end;
$$;

revoke all on function public.recover_stale_outbox_events(integer) from public;
revoke all on function public.recover_stale_outbox_events(integer) from anon, authenticated;
grant execute on function public.recover_stale_outbox_events(integer) to service_role;

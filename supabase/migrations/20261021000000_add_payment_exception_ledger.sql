-- P3E4A: durable review exceptions and audited, non-financial dispositions.

alter table public.payment_attempts
    add constraint payment_attempts_exception_identity_unique
    unique (id, reservation_id, organisation_id);

alter table public.payment_provider_events
    add constraint payment_provider_events_exception_identity_unique
    unique (id, organisation_id, payment_attempt_id);

create table public.payment_exceptions (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    reservation_id uuid not null,
    payment_attempt_id uuid not null,
    source_provider_event_id uuid not null,
    reason_code text not null,
    status text not null default 'unresolved',
    resolution text,
    resolved_at timestamptz,
    resolver_source text,
    resolver_actor text,
    resolution_idempotency_key uuid,
    created_at timestamptz not null default now(),

    constraint payment_exceptions_reservation_org_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations(id, organisation_id),
    constraint payment_exceptions_attempt_org_fkey
        foreign key (payment_attempt_id, reservation_id, organisation_id)
        references public.payment_attempts(id, reservation_id, organisation_id),
    constraint payment_exceptions_source_event_fkey
        foreign key (source_provider_event_id, organisation_id, payment_attempt_id)
        references public.payment_provider_events(id, organisation_id, payment_attempt_id),
    constraint payment_exceptions_identity_unique
        unique (id, organisation_id, reservation_id, payment_attempt_id),
    constraint payment_exceptions_attempt_unique unique (payment_attempt_id),
    constraint payment_exceptions_reason_check
        check (reason_code in ('reservation_cancelled', 'hold_expired', 'confirmation_ineligible')),
    constraint payment_exceptions_status_check check (status in ('unresolved', 'resolved')),
    constraint payment_exceptions_resolution_check
        check (resolution is null or resolution in ('refund_required', 'no_refund_required', 'manual_investigation_complete')),
    constraint payment_exceptions_resolver_source_check
        check (resolver_source is null or resolver_source in ('admin_tool', 'operator_tool')),
    constraint payment_exceptions_resolver_actor_check
        check (resolver_actor is null or (length(trim(resolver_actor)) between 1 and 255 and resolver_actor = trim(resolver_actor))),
    constraint payment_exceptions_resolution_key_check
        check ((status = 'unresolved' and resolved_at is null and resolution is null and resolver_source is null and resolver_actor is null and resolution_idempotency_key is null)
            or (status = 'resolved' and resolved_at is not null and resolution is not null and resolver_source is not null and resolver_actor is not null and resolution_idempotency_key is not null))
);

create unique index payment_exceptions_resolution_key_idx
    on public.payment_exceptions (payment_attempt_id, resolution_idempotency_key)
    where resolution_idempotency_key is not null;

create table public.payment_exception_history (
    id uuid primary key default gen_random_uuid(),
    exception_id uuid not null references public.payment_exceptions(id),
    organisation_id uuid not null references public.organisations(id),
    reservation_id uuid not null,
    payment_attempt_id uuid not null,
    action text not null,
    previous_status text not null,
    resulting_status text not null,
    disposition text not null,
    actor_source text not null,
    actor_id text not null,
    idempotency_key uuid not null,
    occurred_at timestamptz not null default now(),

    constraint payment_exception_history_identity_fkey
        foreign key (exception_id, organisation_id, reservation_id, payment_attempt_id)
        references public.payment_exceptions(id, organisation_id, reservation_id, payment_attempt_id),
    constraint payment_exception_history_identity_check
        check (action = 'resolved' and previous_status = 'unresolved' and resulting_status = 'resolved'
            and disposition in ('refund_required', 'no_refund_required', 'manual_investigation_complete')
            and actor_source in ('admin_tool', 'operator_tool')
            and length(trim(actor_id)) between 1 and 255 and actor_id = trim(actor_id)
            and idempotency_key is not null)
);

create unique index payment_exception_history_idempotency_idx
    on public.payment_exception_history (exception_id, idempotency_key)
    where idempotency_key is not null;

alter table public.payment_exceptions enable row level security;
alter table public.payment_exception_history enable row level security;

revoke all on table public.payment_exceptions from public, anon, authenticated, service_role;
grant select on table public.payment_exceptions to service_role;
revoke all on table public.payment_exception_history from public, anon, authenticated, service_role;

create function public.prevent_payment_exception_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    raise exception 'payment exception history is append-only' using errcode = '42501';
end;
$$;

create trigger payment_exception_history_append_only
before update or delete on public.payment_exception_history
for each row execute function public.prevent_payment_exception_history_mutation();

revoke all on function public.prevent_payment_exception_history_mutation() from public, anon, authenticated;

create function public.create_payment_exception_for_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_reservation public.reservations%rowtype;
    v_event public.payment_provider_events%rowtype;
    v_reason text;
begin
    if old.status not in ('created', 'checkout_open') or new.status <> 'requires_review' then
        return new;
    end if;

    select r.* into v_reservation
    from public.reservations as r
    where r.id = new.reservation_id and r.organisation_id = new.organisation_id;
    if not found then
        raise exception 'review reservation unavailable' using errcode = 'P0001';
    end if;

    select pe.* into v_event
    from public.payment_provider_events as pe
    where pe.payment_attempt_id = new.id
      and pe.organisation_id = new.organisation_id
      and pe.provider = new.provider
      and pe.event_type = 'checkout.session.completed'
      and pe.status in ('received', 'processed')
      and pe.matched_at is not null
      and pe.conflict_detected_at is null
      and pe.payload_sha256 is not null
      and pe.livemode is not null
    order by pe.matched_at desc, pe.id
    limit 1;
    if not found then
        raise exception 'matched provider evidence required for payment review' using errcode = 'P0001';
    end if;

    if v_reservation.status = 'cancelled' then
        v_reason := 'reservation_cancelled';
    elsif exists (
        select 1 from public.allocations as a
        where a.reservation_id = new.reservation_id and a.status = 'held'
          and (a.hold_expires_at is null or a.hold_expires_at <= clock_timestamp())
    ) then
        v_reason := 'hold_expired';
    else
        v_reason := 'confirmation_ineligible';
    end if;

    insert into public.payment_exceptions (
        organisation_id, reservation_id, payment_attempt_id,
        source_provider_event_id, reason_code
    ) values (
        new.organisation_id, new.reservation_id, new.id, v_event.id, v_reason
    ) on conflict (payment_attempt_id) do nothing;

    return new;
end;
$$;

create trigger payment_attempt_requires_review_exception
after update of status on public.payment_attempts
for each row execute function public.create_payment_exception_for_review();

revoke all on function public.create_payment_exception_for_review() from public, anon, authenticated;

create function public.resolve_payment_exception(
    p_exception_id uuid,
    p_organisation_id uuid,
    p_resolution text,
    p_resolver_source text,
    p_resolver_actor text,
    p_idempotency_key uuid
)
returns table (exception_id uuid, outcome text, resolved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_exception public.payment_exceptions%rowtype;
    v_reservation public.reservations%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_now timestamptz;
begin
    if p_exception_id is null or p_organisation_id is null or p_idempotency_key is null
       or p_resolution is null
       or p_resolution not in ('refund_required', 'no_refund_required', 'manual_investigation_complete')
       or p_resolver_source is null
       or p_resolver_source not in ('admin_tool', 'operator_tool')
       or p_resolver_actor is null or length(trim(p_resolver_actor)) not between 1 and 255
       or p_resolver_actor <> trim(p_resolver_actor) then
        raise exception 'invalid payment exception resolution' using errcode = '22023';
    end if;

    select e.* into v_exception
    from public.payment_exceptions as e
    where e.id = p_exception_id and e.organisation_id = p_organisation_id;
    if not found then
        raise exception 'payment exception unavailable' using errcode = 'P0002';
    end if;

    -- Match the reservation -> attempt -> event lock order used by payment authority.
    select r.* into v_reservation
    from public.reservations as r
    where r.id = v_exception.reservation_id and r.organisation_id = p_organisation_id
    for update;
    if not found then
        raise exception 'payment exception unavailable' using errcode = 'P0002';
    end if;

    select pa.* into v_attempt
    from public.payment_attempts as pa
    where pa.id = v_exception.payment_attempt_id
      and pa.reservation_id = v_reservation.id
      and pa.organisation_id = p_organisation_id
    for update;
    if not found then
        raise exception 'payment exception unavailable' using errcode = 'P0002';
    end if;

    select e.* into v_exception
    from public.payment_exceptions as e
    where e.id = p_exception_id
      and e.organisation_id = p_organisation_id
      and e.reservation_id = v_reservation.id
      and e.payment_attempt_id = v_attempt.id
    for update;
    if not found then
        raise exception 'payment exception unavailable' using errcode = 'P0002';
    end if;

    if v_exception.status = 'resolved' then
        if v_exception.resolution = p_resolution
           and v_exception.resolver_source = p_resolver_source
           and v_exception.resolver_actor = p_resolver_actor
           and v_exception.resolution_idempotency_key = p_idempotency_key then
            return query select v_exception.id, 'already_resolved'::text, v_exception.resolved_at;
            return;
        end if;
        raise exception 'payment exception already resolved differently' using errcode = 'P0001';
    end if;

    if v_attempt.status <> 'requires_review'
       or v_attempt.paid_at is null
       or v_reservation.payment_status <> 'requires_review' then
        raise exception 'payment exception state is inconsistent' using errcode = 'P0001';
    end if;

    v_now := clock_timestamp();
    update public.payment_exceptions as e
    set status = 'resolved', resolution = p_resolution, resolved_at = v_now,
        resolver_source = p_resolver_source, resolver_actor = p_resolver_actor,
        resolution_idempotency_key = p_idempotency_key
    where e.id = p_exception_id and e.status = 'unresolved';
    if not found then
        raise exception 'payment exception changed during resolution' using errcode = '40001';
    end if;

    insert into public.payment_exception_history (
        exception_id, organisation_id, reservation_id, payment_attempt_id,
        action, previous_status, resulting_status, disposition,
        actor_source, actor_id, idempotency_key, occurred_at
    ) values (
        p_exception_id, p_organisation_id, v_reservation.id, v_attempt.id,
        'resolved', 'unresolved', 'resolved', p_resolution,
        p_resolver_source, p_resolver_actor, p_idempotency_key, v_now
    );

    return query select p_exception_id, 'resolved'::text, v_now;
end;
$$;

revoke all on function public.resolve_payment_exception(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_payment_exception(uuid, uuid, text, text, text, uuid) to service_role;

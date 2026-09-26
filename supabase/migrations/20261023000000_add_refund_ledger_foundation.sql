-- P3E4C1: durable full-refund preparation and provider-evidence foundation.
-- This migration records refund authority and evidence only; it never calls Stripe.

create table public.payment_refunds (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    reservation_id uuid not null,
    payment_attempt_id uuid not null,
    payment_exception_id uuid not null,
    provider text not null default 'stripe',
    amount numeric(10,2) not null,
    currency text not null default 'EUR',
    status text not null default 'prepared',
    disposition text not null default 'refund_required',
    resolution_source text not null,
    resolution_actor text not null,
    prepared_source text not null,
    prepared_actor text not null,
    preparation_idempotency_key uuid not null,
    prepared_at timestamptz not null default clock_timestamp(),
    provider_refund_id text,
    evidence_outcome text,
    evidence_source text,
    evidence_actor_source text,
    evidence_actor text,
    evidence_idempotency_key uuid,
    evidence_recorded_at timestamptz,
    finalized_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),

    constraint payment_refunds_exception_identity_fkey
        foreign key (payment_exception_id, organisation_id, reservation_id, payment_attempt_id)
        references public.payment_exceptions(id, organisation_id, reservation_id, payment_attempt_id),
    constraint payment_refunds_attempt_identity_fkey
        foreign key (payment_attempt_id, reservation_id, organisation_id)
        references public.payment_attempts(id, reservation_id, organisation_id),
    constraint payment_refunds_identity_unique
        unique (id, organisation_id, reservation_id, payment_attempt_id),
    constraint payment_refunds_attempt_unique unique (payment_attempt_id),
    constraint payment_refunds_provider_check check (provider = 'stripe'),
    constraint payment_refunds_amount_check check (amount > 0),
    constraint payment_refunds_currency_check check (currency = 'EUR'),
    constraint payment_refunds_status_check check (status in ('prepared', 'succeeded', 'failed')),
    constraint payment_refunds_disposition_check check (disposition = 'refund_required'),
    constraint payment_refunds_actor_source_check check (
        resolution_source in ('admin_tool', 'operator_tool')
        and prepared_source in ('admin_tool', 'operator_tool')
        and (evidence_actor_source is null or evidence_actor_source in ('admin_tool', 'operator_tool'))
    ),
    constraint payment_refunds_actor_check check (
        length(trim(resolution_actor)) between 1 and 255 and resolution_actor = trim(resolution_actor)
        and length(trim(prepared_actor)) between 1 and 255 and prepared_actor = trim(prepared_actor)
        and (evidence_actor is null or (length(trim(evidence_actor)) between 1 and 255 and evidence_actor = trim(evidence_actor)))
    ),
    constraint payment_refunds_provider_id_check check (
        provider_refund_id is null or
        (length(trim(provider_refund_id)) between 1 and 255 and provider_refund_id = trim(provider_refund_id))
    ),
    constraint payment_refunds_evidence_source_check check (
        evidence_source is null or evidence_source in ('stripe_api', 'stripe_dashboard_reconciliation')
    ),
    constraint payment_refunds_evidence_consistency_check check (
        (status = 'prepared' and provider_refund_id is null and evidence_outcome is null
            and evidence_source is null and evidence_actor_source is null and evidence_actor is null
            and evidence_idempotency_key is null and evidence_recorded_at is null and finalized_at is null)
        or
        (status in ('succeeded', 'failed') and provider_refund_id is not null
            and evidence_outcome = status and evidence_source is not null
            and evidence_actor_source is not null and evidence_actor is not null
            and evidence_idempotency_key is not null and evidence_recorded_at is not null
            and finalized_at is not null)
    )
);

create unique index payment_refunds_provider_identity_idx
    on public.payment_refunds (provider, provider_refund_id)
    where provider_refund_id is not null;
create unique index payment_refunds_preparation_idempotency_idx
    on public.payment_refunds (payment_exception_id, preparation_idempotency_key);

create table public.payment_refund_history (
    id uuid primary key default gen_random_uuid(),
    refund_id uuid not null,
    organisation_id uuid not null,
    reservation_id uuid not null,
    payment_attempt_id uuid not null,
    action text not null,
    previous_status text not null,
    resulting_status text not null,
    provider_refund_id text,
    evidence_outcome text,
    evidence_source text,
    actor_source text not null,
    actor_id text not null,
    idempotency_key uuid not null,
    occurred_at timestamptz not null default clock_timestamp(),

    constraint payment_refund_history_identity_fkey
        foreign key (refund_id, organisation_id, reservation_id, payment_attempt_id)
        references public.payment_refunds(id, organisation_id, reservation_id, payment_attempt_id),
    constraint payment_refund_history_action_check check (
        (action = 'prepared' and previous_status = 'none' and resulting_status = 'prepared'
            and provider_refund_id is null and evidence_outcome is null and evidence_source is null)
        or
        (action in ('succeeded', 'failed') and previous_status = 'prepared'
            and resulting_status = action and provider_refund_id is not null
            and evidence_outcome = action and evidence_source in ('stripe_api', 'stripe_dashboard_reconciliation'))
    ),
    constraint payment_refund_history_actor_check check (
        actor_source in ('admin_tool', 'operator_tool')
        and length(trim(actor_id)) between 1 and 255 and actor_id = trim(actor_id)
    )
);
create unique index payment_refund_history_idempotency_idx
    on public.payment_refund_history (refund_id, idempotency_key);

alter table public.payment_refunds enable row level security;
alter table public.payment_refund_history enable row level security;
revoke all on table public.payment_refunds from public, anon, authenticated, service_role;
grant select on table public.payment_refunds to service_role;
revoke all on table public.payment_refund_history from public, anon, authenticated, service_role;

create function public.prevent_payment_refund_history_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    raise exception 'payment refund history is append-only' using errcode = '42501';
end;
$$;
create trigger payment_refund_history_append_only
before update or delete on public.payment_refund_history
for each row execute function public.prevent_payment_refund_history_mutation();
revoke all on function public.prevent_payment_refund_history_mutation() from public, anon, authenticated;

create function public.prepare_payment_refund(
    p_exception_id uuid,
    p_organisation_id uuid,
    p_actor_source text,
    p_actor_id text,
    p_idempotency_key uuid
)
returns table (refund_id uuid, outcome text, amount numeric, currency text, prepared_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
    v_exception public.payment_exceptions%rowtype;
    v_reservation public.reservations%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_refund public.payment_refunds%rowtype;
    v_now timestamptz;
begin
    if p_exception_id is null or p_organisation_id is null or p_idempotency_key is null
       or p_actor_source is null or p_actor_source not in ('admin_tool', 'operator_tool')
       or p_actor_id is null or length(trim(p_actor_id)) not between 1 and 255 or p_actor_id <> trim(p_actor_id) then
        raise exception 'invalid refund preparation request' using errcode = '22023';
    end if;

    select e.* into v_exception from public.payment_exceptions e
    where e.id = p_exception_id and e.organisation_id = p_organisation_id;
    if not found then raise exception 'payment exception unavailable' using errcode = 'P0002'; end if;

    select r.* into v_reservation from public.reservations r
    where r.id = v_exception.reservation_id and r.organisation_id = p_organisation_id for update;
    if not found then raise exception 'payment exception unavailable' using errcode = 'P0002'; end if;

    select pa.* into v_attempt from public.payment_attempts pa
    where pa.id = v_exception.payment_attempt_id and pa.reservation_id = v_reservation.id
      and pa.organisation_id = p_organisation_id for update;
    if not found then raise exception 'payment exception unavailable' using errcode = 'P0002'; end if;

    select e.* into v_exception from public.payment_exceptions e
    where e.id = p_exception_id and e.organisation_id = p_organisation_id
      and e.reservation_id = v_reservation.id and e.payment_attempt_id = v_attempt.id for update;
    if not found then raise exception 'payment exception unavailable' using errcode = 'P0002'; end if;

    select pr.* into v_refund from public.payment_refunds pr where pr.payment_exception_id = v_exception.id for update;
    if found then
        if v_refund.preparation_idempotency_key = p_idempotency_key
           and v_refund.prepared_source = p_actor_source and v_refund.prepared_actor = p_actor_id then
            return query select v_refund.id, 'already_prepared'::text, v_refund.amount, v_refund.currency, v_refund.prepared_at;
            return;
        end if;
        raise exception 'refund already prepared differently' using errcode = 'P0001';
    end if;

    if v_exception.status <> 'resolved' or v_exception.resolution <> 'refund_required'
       or v_attempt.provider <> 'stripe' or v_attempt.purpose <> 'rental'
       or v_attempt.status <> 'requires_review' or v_attempt.paid_at is null
       or v_reservation.payment_status <> 'requires_review'
       or v_attempt.currency <> 'EUR' or v_attempt.amount <= 0
       or v_attempt.amount <> v_reservation.total_amount then
        raise exception 'payment is not eligible for refund preparation' using errcode = 'P0001';
    end if;

    v_now := clock_timestamp();
    insert into public.payment_refunds (
        organisation_id, reservation_id, payment_attempt_id, payment_exception_id,
        amount, currency, resolution_source, resolution_actor, prepared_source,
        prepared_actor, preparation_idempotency_key, prepared_at, created_at, updated_at
    ) values (
        p_organisation_id, v_reservation.id, v_attempt.id, v_exception.id,
        v_attempt.amount, v_attempt.currency, v_exception.resolver_source, v_exception.resolver_actor,
        p_actor_source, p_actor_id, p_idempotency_key, v_now, v_now, v_now
    ) returning * into v_refund;

    insert into public.payment_refund_history (
        refund_id, organisation_id, reservation_id, payment_attempt_id, action,
        previous_status, resulting_status, actor_source, actor_id, idempotency_key, occurred_at
    ) values (
        v_refund.id, v_refund.organisation_id, v_refund.reservation_id, v_refund.payment_attempt_id,
        'prepared', 'none', 'prepared', p_actor_source, p_actor_id, p_idempotency_key, v_now
    );
    return query select v_refund.id, 'prepared'::text, v_refund.amount, v_refund.currency, v_now;
end;
$$;

create function public.record_payment_refund_evidence(
    p_refund_id uuid,
    p_organisation_id uuid,
    p_provider_refund_id text,
    p_evidence_outcome text,
    p_evidence_source text,
    p_actor_source text,
    p_actor_id text,
    p_idempotency_key uuid
)
returns table (refund_id uuid, outcome text, finalized_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
    v_initial public.payment_refunds%rowtype;
    v_refund public.payment_refunds%rowtype;
    v_reservation public.reservations%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_now timestamptz;
begin
    if p_refund_id is null or p_organisation_id is null or p_idempotency_key is null
       or p_provider_refund_id is null or length(trim(p_provider_refund_id)) not between 1 and 255
       or p_provider_refund_id <> trim(p_provider_refund_id)
       or p_evidence_outcome is null or p_evidence_outcome not in ('succeeded', 'failed')
       or p_evidence_source is null or p_evidence_source not in ('stripe_api', 'stripe_dashboard_reconciliation')
       or p_actor_source is null or p_actor_source not in ('admin_tool', 'operator_tool')
       or p_actor_id is null or length(trim(p_actor_id)) not between 1 and 255 or p_actor_id <> trim(p_actor_id) then
        raise exception 'invalid refund evidence' using errcode = '22023';
    end if;

    select pr.* into v_initial from public.payment_refunds pr
    where pr.id = p_refund_id and pr.organisation_id = p_organisation_id;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    select r.* into v_reservation from public.reservations r
    where r.id = v_initial.reservation_id and r.organisation_id = p_organisation_id for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;
    select pa.* into v_attempt from public.payment_attempts pa
    where pa.id = v_initial.payment_attempt_id and pa.reservation_id = v_reservation.id
      and pa.organisation_id = p_organisation_id for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;
    select pr.* into v_refund from public.payment_refunds pr
    where pr.id = p_refund_id and pr.organisation_id = p_organisation_id
      and pr.reservation_id = v_reservation.id and pr.payment_attempt_id = v_attempt.id for update;
    if not found then raise exception 'payment refund unavailable' using errcode = 'P0002'; end if;

    if v_refund.status <> 'prepared' then
        if v_refund.provider_refund_id = p_provider_refund_id
           and v_refund.evidence_outcome = p_evidence_outcome
           and v_refund.evidence_source = p_evidence_source
           and v_refund.evidence_actor_source = p_actor_source
           and v_refund.evidence_actor = p_actor_id
           and v_refund.evidence_idempotency_key = p_idempotency_key then
            return query select v_refund.id, 'already_recorded'::text, v_refund.finalized_at;
            return;
        end if;
        raise exception 'refund evidence conflicts with recorded result' using errcode = 'P0001';
    end if;
    if v_attempt.status <> 'requires_review' or v_attempt.paid_at is null
       or v_reservation.payment_status <> 'requires_review'
       or v_attempt.amount <> v_refund.amount or v_attempt.currency <> v_refund.currency then
        raise exception 'payment state is inconsistent with prepared refund' using errcode = 'P0001';
    end if;

    v_now := clock_timestamp();
    update public.payment_refunds pr set
        status = p_evidence_outcome, provider_refund_id = p_provider_refund_id,
        evidence_outcome = p_evidence_outcome, evidence_source = p_evidence_source,
        evidence_actor_source = p_actor_source, evidence_actor = p_actor_id,
        evidence_idempotency_key = p_idempotency_key, evidence_recorded_at = v_now,
        finalized_at = v_now, updated_at = v_now
    where pr.id = p_refund_id and pr.status = 'prepared';
    if not found then raise exception 'refund changed during evidence recording' using errcode = '40001'; end if;

    if p_evidence_outcome = 'succeeded' then
        update public.payment_attempts pa set status = 'refunded', refunded_at = v_now, updated_at = v_now
        where pa.id = v_attempt.id and pa.status = 'requires_review' and pa.paid_at is not null;
        if not found then raise exception 'payment attempt changed during refund finalization' using errcode = '40001'; end if;
        update public.reservations r set payment_status = 'refunded', updated_at = v_now
        where r.id = v_reservation.id and r.payment_status = 'requires_review';
        if not found then raise exception 'reservation payment state changed during refund finalization' using errcode = '40001'; end if;
    end if;

    insert into public.payment_refund_history (
        refund_id, organisation_id, reservation_id, payment_attempt_id, action,
        previous_status, resulting_status, provider_refund_id, evidence_outcome,
        evidence_source, actor_source, actor_id, idempotency_key, occurred_at
    ) values (
        v_refund.id, v_refund.organisation_id, v_refund.reservation_id, v_refund.payment_attempt_id,
        p_evidence_outcome, 'prepared', p_evidence_outcome, p_provider_refund_id,
        p_evidence_outcome, p_evidence_source, p_actor_source, p_actor_id, p_idempotency_key, v_now
    );
    return query select v_refund.id, p_evidence_outcome, v_now;
end;
$$;

revoke all on function public.prepare_payment_refund(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_payment_refund(uuid, uuid, text, text, uuid) to service_role;
revoke all on function public.record_payment_refund_evidence(uuid, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_payment_refund_evidence(uuid, uuid, text, text, text, text, text, uuid) to service_role;

-- P2C Checkout state and active-attempt defense in depth.
-- Stripe is contacted only by the Edge Function, never by PostgreSQL.

alter table public.payment_attempts
    add column provider_checkout_url text;

do $$
begin
    if exists (
        select 1
        from public.payment_attempts
        where status in ('created', 'checkout_open')
        group by organisation_id, reservation_id, purpose
        having count(*) > 1
    ) then
        raise exception
            'cannot add active payment-attempt uniqueness: duplicate active attempts exist';
    end if;
end;
$$;

create unique index payment_attempts_one_active_rental_idx
    on public.payment_attempts (organisation_id, reservation_id, purpose)
    where status in ('created', 'checkout_open');

create or replace function public.get_reservation_payment_checkout(
    p_payment_attempt_id uuid,
    p_organisation_id uuid
)
returns table (
    payment_attempt_id uuid,
    reservation_id uuid,
    organisation_id uuid,
    amount numeric,
    currency text,
    attempt_status text,
    provider_checkout_session_id text,
    provider_checkout_url text,
    provider_payment_intent_id text,
    customer_email text,
    hold_expires_at timestamptz,
    eligible boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
    v_reservation public.reservations%rowtype;
    v_email text;
    v_hold_expires_at timestamptz;
    v_allocation_count integer := 0;
    v_held_allocation_count integer := 0;
    v_eligible boolean := false;
begin
    select pa.*
    into v_attempt
    from public.payment_attempts as pa
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select r.*
    into v_reservation
    from public.reservations as r
    where r.id = v_attempt.reservation_id
      and r.organisation_id = v_attempt.organisation_id;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select c.email
    into v_email
    from public.customers as c
    where c.id = v_reservation.customer_id
      and c.organisation_id = v_reservation.organisation_id;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select count(*)::integer,
           count(*) filter (where a.status = 'held')::integer,
           max(a.hold_expires_at) filter (where a.status = 'held')
    into v_allocation_count, v_held_allocation_count, v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = v_reservation.id;

    v_eligible := v_attempt.status in ('created', 'checkout_open')
        and v_reservation.status = 'pending'
        and v_reservation.payment_status not in ('paid', 'processing', 'requires_review', 'refunded')
        and v_allocation_count > 0
        and v_held_allocation_count = 1
        and v_hold_expires_at is not null
        and v_hold_expires_at > now();

    return query
    select v_attempt.id,
           v_reservation.id,
           v_reservation.organisation_id,
           v_attempt.amount,
           v_attempt.currency,
           v_attempt.status,
           v_attempt.provider_checkout_session_id,
           v_attempt.provider_checkout_url,
           v_attempt.provider_payment_intent_id,
           v_email,
           v_hold_expires_at,
           v_eligible;
end;
$$;

create or replace function public.persist_reservation_payment_checkout(
    p_payment_attempt_id uuid,
    p_organisation_id uuid,
    p_provider_checkout_session_id text,
    p_provider_checkout_url text,
    p_provider_payment_intent_id text default null
)
returns table (
    provider_checkout_session_id text,
    provider_checkout_url text,
    hold_expires_at timestamptz,
    eligible boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
    v_reservation public.reservations%rowtype;
    v_state record;
begin
    if p_provider_checkout_session_id is null
       or length(trim(p_provider_checkout_session_id)) = 0
       or p_provider_checkout_url is null
       or length(trim(p_provider_checkout_url)) = 0 then
        raise exception 'invalid checkout state' using errcode = '22023';
    end if;

    select *
    into v_attempt
    from public.payment_attempts as pa
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id
    for update;

    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    select r.*
    into v_reservation
    from public.reservations as r
    where r.id = v_attempt.reservation_id
      and r.organisation_id = v_attempt.organisation_id
    for update;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;

    perform 1
    from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;

    if v_attempt.provider_checkout_session_id is not null
       and v_attempt.provider_checkout_session_id <> p_provider_checkout_session_id then
        raise exception 'conflicting checkout session' using errcode = 'P0001';
    end if;

    if v_attempt.provider_checkout_url is not null
       and v_attempt.provider_checkout_url <> p_provider_checkout_url then
        raise exception 'conflicting checkout url' using errcode = 'P0001';
    end if;

    if p_provider_payment_intent_id is not null
       and v_attempt.provider_payment_intent_id is not null
       and v_attempt.provider_payment_intent_id <> p_provider_payment_intent_id then
        raise exception 'conflicting payment intent' using errcode = 'P0001';
    end if;

    select *
    into v_state
    from public.get_reservation_payment_checkout(
        p_payment_attempt_id,
        p_organisation_id
    );

    if v_attempt.status not in ('created', 'checkout_open') then
        raise exception 'payment attempt is not reusable' using errcode = 'P0001';
    end if;

    update public.payment_attempts as pa
    set provider_checkout_session_id = p_provider_checkout_session_id,
        provider_checkout_url = p_provider_checkout_url,
        provider_payment_intent_id = coalesce(
            p_provider_payment_intent_id,
            pa.provider_payment_intent_id
        ),
        status = 'checkout_open',
        updated_at = now()
    where pa.id = p_payment_attempt_id
      and pa.organisation_id = p_organisation_id;

    return query
    select p_provider_checkout_session_id,
           p_provider_checkout_url,
           v_state.hold_expires_at,
           v_state.eligible;
end;
$$;

revoke all on function public.get_reservation_payment_checkout(uuid, uuid) from public;
revoke all on function public.get_reservation_payment_checkout(uuid, uuid) from anon, authenticated;
grant execute on function public.get_reservation_payment_checkout(uuid, uuid) to service_role;

revoke all on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) from public;
revoke all on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.persist_reservation_payment_checkout(uuid, uuid, text, text, text) to service_role;

-- Recreate P2B only to defend its final insert against the active-attempt index.
create or replace function public.initiate_reservation_payment(
    p_reservation_id uuid,
    p_capability_hash text,
    p_idempotency_key text
)
returns table (
    payment_attempt_id uuid,
    reservation_id uuid,
    organisation_id uuid,
    amount numeric,
    currency text,
    attempt_status text,
    hold_expires_at timestamptz,
    reused boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation public.reservations%rowtype;
    v_capability public.reservation_payment_capabilities%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_allocation_count integer := 0;
    v_held_allocation_count integer := 0;
    v_hold_expires_at timestamptz;
    v_key text;
    v_constraint text;
    v_message text;
begin
    if p_reservation_id is null then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;
    if p_capability_hash is null or p_capability_hash !~ '^\\\\x[0-9a-f]{64}$' then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;
    if p_idempotency_key is null
       or length(trim(p_idempotency_key)) not between 1 and 255
       or p_idempotency_key <> trim(p_idempotency_key) then
        raise exception 'invalid payment initiation request' using errcode = '22023';
    end if;
    v_key := trim(p_idempotency_key);

    select * into v_reservation
    from public.reservations as r
    where r.id = p_reservation_id
    for update;
    if not found then
        raise exception 'payment initiation unavailable' using errcode = 'P0002';
    end if;
    if v_reservation.status <> 'pending'
       or v_reservation.payment_status in ('paid', 'requires_review', 'refunded') then
        raise exception 'reservation is not payable' using errcode = 'P0001';
    end if;

    perform 1 from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;
    select count(*)::integer,
           count(*) filter (where a.status = 'held')::integer
    into v_allocation_count, v_held_allocation_count
    from public.allocations as a
    where a.reservation_id = v_reservation.id;
    if v_allocation_count = 0 or v_held_allocation_count <> 1 then
        raise exception 'reservation hold is not payable' using errcode = 'P0001';
    end if;
    select a.hold_expires_at into v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = v_reservation.id and a.status = 'held'
    order by a.id limit 1;
    if v_hold_expires_at is null or v_hold_expires_at < now() + interval '10 minutes' then
        raise exception 'reservation hold is expiring' using errcode = 'P0001';
    end if;

    select * into v_capability
    from public.reservation_payment_capabilities as c
    where c.reservation_id = v_reservation.id
    for update;
    if not found
       or v_capability.organisation_id <> v_reservation.organisation_id
       or v_capability.capability_hash <> lower(p_capability_hash)
       or v_capability.expires_at <= now()
       or v_capability.revoked_at is not null
       or v_capability.used_at is not null then
        raise exception 'payment capability is invalid' using errcode = 'P0001';
    end if;

    perform 1 from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
    order by pa.created_at, pa.id
    for update;
    select * into v_attempt
    from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
      and pa.status in ('created', 'checkout_open')
    order by pa.created_at, pa.id limit 1;
    if found then
        return query select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
            v_attempt.amount, v_attempt.currency, v_attempt.status, v_hold_expires_at, true;
        return;
    end if;

    select * into v_attempt
    from public.payment_attempts as pa
    where pa.organisation_id = v_reservation.organisation_id
      and pa.reservation_id = v_reservation.id
      and pa.provider = 'stripe'
      and pa.purpose = 'rental'
      and pa.idempotency_key = v_key;
    if found then
        if v_attempt.status = 'failed' then
            raise exception 'payment attempt already failed' using errcode = 'P0001';
        elsif v_attempt.status in ('paid', 'requires_review', 'refunded') then
            raise exception 'payment attempt is not reusable' using errcode = 'P0001';
        end if;
    end if;
    if v_reservation.payment_status = 'processing' then
        raise exception 'payment state is inconsistent' using errcode = 'P0001';
    end if;

    begin
        insert into public.payment_attempts (
            organisation_id, reservation_id, provider, purpose, amount, currency,
            status, idempotency_key
        ) values (
            v_reservation.organisation_id, v_reservation.id, 'stripe', 'rental',
            v_reservation.total_amount, 'EUR', 'created', v_key
        ) returning * into v_attempt;
    exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name, v_message = message_text;
        if coalesce(v_constraint, '') <> 'payment_attempts_one_active_rental_idx'
           and v_message not like '%payment_attempts_one_active_rental_idx%' then
            raise;
        end if;
        select * into v_attempt
        from public.payment_attempts as pa
        where pa.organisation_id = v_reservation.organisation_id
          and pa.reservation_id = v_reservation.id
          and pa.provider = 'stripe'
          and pa.purpose = 'rental'
          and pa.status in ('created', 'checkout_open')
        order by pa.created_at, pa.id limit 1;
        if not found then
            raise;
        end if;
        return query select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
            v_attempt.amount, v_attempt.currency, v_attempt.status, v_hold_expires_at, true;
        return;
    end;

    return query select v_attempt.id, v_reservation.id, v_reservation.organisation_id,
        v_attempt.amount, v_attempt.currency, v_attempt.status, v_hold_expires_at, false;
end;
$$;

revoke all on function public.initiate_reservation_payment(uuid, text, text) from public;
revoke all on function public.initiate_reservation_payment(uuid, text, text) from anon, authenticated;
grant execute on function public.initiate_reservation_payment(uuid, text, text) to service_role;

-- Reservation-scoped payment bearer capability foundation.
-- Only a hash is persisted; the raw capability is never stored.

create table public.reservation_payment_capabilities (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    reservation_id uuid not null,
    capability_hash text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz,
    revoked_at timestamptz,

    constraint reservation_payment_capabilities_reservation_organisation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations(id, organisation_id),
    constraint reservation_payment_capabilities_hash_check
        check (capability_hash ~ '^\\\\x[0-9a-f]{64}$'),
    constraint reservation_payment_capabilities_expiry_check
        check (expires_at > created_at),
    constraint reservation_payment_capabilities_lifecycle_check
        check (not (used_at is not null and revoked_at is not null)),
    constraint reservation_payment_capabilities_one_per_reservation_unique
        unique (reservation_id)
);

create index reservation_payment_capabilities_lookup_idx
    on public.reservation_payment_capabilities (organisation_id, capability_hash);

alter table public.reservation_payment_capabilities enable row level security;

revoke all privileges on table public.reservation_payment_capabilities from public;
revoke all privileges on table public.reservation_payment_capabilities from anon, authenticated, service_role;
grant select, insert, update on table public.reservation_payment_capabilities to service_role;

-- Atomic trusted wrapper: the existing 24-argument reservation transaction
-- remains unchanged; this wrapper persists capability state in the same call.
create function public.create_reservation_with_payment_capability(
    p_capability_hash text,
    p_first_name text,
    p_last_name text,
    p_email text,
    p_phone text,
    p_product_id text,
    p_rental_start timestamptz,
    p_rental_end timestamptz,
    p_delivery_address_line_1 text,
    p_delivery_address_line_2 text,
    p_delivery_postcode text,
    p_delivery_city text,
    p_delivery_zone text,
    p_weekly_price_at_booking numeric,
    p_delivery_fee numeric,
    p_options_total numeric,
    p_deposit_amount numeric,
    p_total_amount numeric,
    p_delivery_date date,
    p_delivery_time_slot text,
    p_collection_date date,
    p_collection_time_slot text,
    p_idempotency_key text,
    p_operational_start timestamp without time zone,
    p_operational_end timestamp without time zone
)
returns table (
    customer_id uuid,
    reservation_id uuid,
    delivery_job_id uuid,
    collection_job_id uuid,
    allocation_id uuid,
    machine_id text,
    reservation_status text,
    hold_expires_at timestamptz,
    created_new boolean,
    payment_capability_matched boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_result record;
    v_organisation_id uuid;
    v_capability_matched boolean := true;
begin
    if p_capability_hash is null
       or p_capability_hash !~ '^\\\\x[0-9a-f]{64}$' then
        raise exception 'invalid payment capability hash' using errcode = '22023';
    end if;

    select * into v_result
    from public.create_reservation_transaction(
        p_first_name, p_last_name, p_email, p_phone, p_product_id,
        p_rental_start, p_rental_end, p_delivery_address_line_1,
        p_delivery_address_line_2, p_delivery_postcode, p_delivery_city,
        p_delivery_zone, p_weekly_price_at_booking, p_delivery_fee,
        p_options_total, p_deposit_amount, p_total_amount, p_delivery_date,
        p_delivery_time_slot, p_collection_date, p_collection_time_slot,
        p_idempotency_key, p_operational_start, p_operational_end
    );

    if v_result.reservation_status = 'pending'
       and v_result.hold_expires_at is not null then
        select r.organisation_id into v_organisation_id
        from public.reservations as r
        where r.id = v_result.reservation_id;

        insert into public.reservation_payment_capabilities (
            organisation_id, reservation_id, capability_hash, expires_at
        ) values (
            v_organisation_id, v_result.reservation_id,
            lower(p_capability_hash), v_result.hold_expires_at
        )
        on conflict on constraint reservation_payment_capabilities_one_per_reservation_unique do nothing;

        select c.capability_hash = lower(p_capability_hash)
        into v_capability_matched
        from public.reservation_payment_capabilities as c
        where c.reservation_id = v_result.reservation_id;
    end if;

    return query select v_result.customer_id, v_result.reservation_id,
        v_result.delivery_job_id, v_result.collection_job_id,
        v_result.allocation_id, v_result.machine_id,
        v_result.reservation_status, v_result.hold_expires_at,
        v_result.created_new, v_capability_matched;
end;
$$;

revoke all on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone
) from public;
revoke all on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone
) from anon, authenticated;
grant execute on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone
) to service_role;

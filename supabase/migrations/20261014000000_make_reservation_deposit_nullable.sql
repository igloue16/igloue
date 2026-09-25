-- MM3C0A: a reservation may have no traditional monetary deposit.
-- NULL means no traditional deposit applies to this reservation. It is not
-- a damage-liability, saved-card, or payment-authority field.

alter table public.reservations
    alter column deposit_amount drop not null;

-- Keep the current normalized creation contract and authority boundary, while
-- allowing the explicit no-traditional-deposit snapshot. Numeric deposits
-- still have to equal the authoritative product deposit.
create or replace function public.create_reservation_with_payment_capability(
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
    p_operational_end timestamp without time zone,
    p_recipient_first_name text,
    p_recipient_last_name text,
    p_recipient_phone text,
    p_billing_mode text,
    p_billing_name text,
    p_billing_company_name text,
    p_billing_email text,
    p_billing_address_line_1 text,
    p_billing_address_line_2 text,
    p_billing_postcode text,
    p_billing_city text,
    p_billing_country text,
    p_unit_rental_price numeric,
    p_line_total numeric
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
    v_weekly_price numeric;
    v_deposit_amount numeric;
    v_expected_line_total numeric;
begin
    if p_capability_hash is null
       or length(p_capability_hash) <> 66
       or left(p_capability_hash, 2) <> chr(92) || 'x'
       or substring(p_capability_hash from 3) !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid payment capability hash' using errcode = '22023';
    end if;

    select p.weekly_price, p.deposit_amount
    into v_weekly_price, v_deposit_amount
    from public.products as p
    where p.id = p_product_id
      and p.active = true;

    if not found then
        raise exception 'invalid active product' using errcode = '22023';
    end if;

    v_expected_line_total := round(
        (v_weekly_price / 7)
        * greatest(3, (p_rental_end::date - p_rental_start::date))::numeric,
        2
    );

    if p_unit_rental_price is null
       or p_unit_rental_price <> v_weekly_price
       or p_line_total is null
       or p_line_total <> v_expected_line_total
       or p_weekly_price_at_booking <> v_weekly_price
       or (p_deposit_amount is not null
           and p_deposit_amount is distinct from v_deposit_amount)
       or p_total_amount <> p_line_total + p_delivery_fee + p_options_total then
        raise exception 'authoritative reservation pricing mismatch' using errcode = '22023';
    end if;

    select * into v_result
    from public.create_reservation_with_payment_capability(
        p_capability_hash, p_first_name, p_last_name, p_email, p_phone,
        p_product_id, p_rental_start, p_rental_end,
        p_delivery_address_line_1, p_delivery_address_line_2,
        p_delivery_postcode, p_delivery_city, p_delivery_zone,
        p_weekly_price_at_booking, p_delivery_fee, p_options_total,
        p_deposit_amount, p_total_amount, p_delivery_date,
        p_delivery_time_slot, p_collection_date, p_collection_time_slot,
        p_idempotency_key, p_operational_start, p_operational_end
    );

    if v_result.created_new = true then
        select r.organisation_id
        into v_organisation_id
        from public.reservations as r
        where r.id = v_result.reservation_id;

        update public.reservations
        set recipient_first_name = p_recipient_first_name,
            recipient_last_name = p_recipient_last_name,
            recipient_phone = p_recipient_phone
        where id = v_result.reservation_id
          and organisation_id = v_organisation_id;

        insert into public.reservation_items (
            organisation_id, reservation_id, product_id,
            unit_rental_price, line_total
        ) values (
            v_organisation_id, v_result.reservation_id, p_product_id,
            p_unit_rental_price, p_line_total
        );

        insert into public.reservation_billing_details (
            organisation_id, reservation_id, billing_mode, billing_name,
            company_name, billing_email, billing_address_line_1,
            billing_address_line_2, billing_postcode, billing_city,
            billing_country
        ) values (
            v_organisation_id, v_result.reservation_id, p_billing_mode,
            p_billing_name, p_billing_company_name, p_billing_email,
            p_billing_address_line_1, p_billing_address_line_2,
            p_billing_postcode, p_billing_city, p_billing_country
        );
    end if;

    return query select v_result.customer_id, v_result.reservation_id,
        v_result.delivery_job_id, v_result.collection_job_id,
        v_result.allocation_id, v_result.machine_id,
        v_result.reservation_status, v_result.hold_expires_at,
        v_result.created_new, v_result.payment_capability_matched;
end;
$$;

revoke all on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone,
    text, text, text, text, text, text, text, text, text, text, text,
    text, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone,
    text, text, text, text, text, text, text, text, text, text, text,
    text, numeric, numeric
) to service_role;

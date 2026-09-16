-- Integrate physical-machine holding into the reservation transaction.
--
-- A successful reservation must now have an eligible physical machine
-- held for its operational period.
--
-- The operational start/end values supplied by the backend are French
-- civil (wall-clock) timestamps. PostgreSQL explicitly interprets them
-- in Europe/Paris before passing them to create_machine_hold.
--
-- Because the machine hold happens inside the same PostgreSQL function,
-- failure to obtain a machine rolls back the customer, reservation and
-- service jobs created by this transaction.

drop function public.create_reservation_transaction(
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    text,
    text,
    text,
    text,
    text,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    date,
    text,
    date,
    text,
    text
);

create function public.create_reservation_transaction(
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
    machine_id text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_customer_id uuid;
    v_reservation_id uuid;
    v_delivery_job_id uuid;
    v_collection_job_id uuid;
    v_allocation_id uuid;
    v_machine_id text;
    v_operational_start timestamptz;
    v_operational_end timestamptz;
begin
    if p_idempotency_key is null
       or length(trim(p_idempotency_key)) = 0 then
        raise exception 'idempotency key is required';
    end if;

    if p_operational_start is null
       or p_operational_end is null then
        raise exception 'operational period is required';
    end if;

    -- Convert IGLOUE's French civil times into real instants.
    --
    -- Example during French summer time:
    -- 2026-09-20 06:30 Europe/Paris becomes
    -- 2026-09-20 04:30 UTC internally.
    --
    -- PostgreSQL's timezone database handles DST rules.

    v_operational_start :=
        p_operational_start at time zone 'Europe/Paris';

    v_operational_end :=
        p_operational_end at time zone 'Europe/Paris';

    if v_operational_end <= v_operational_start then
        raise exception 'operational end must be after operational start';
    end if;

    -- Serialize requests using the same idempotency key.
    --
    -- Concurrent retries using the same key cannot create duplicate
    -- reservations.

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            trim(p_idempotency_key),
            0
        )
    );

    select
        r.customer_id,
        r.id
    into
        v_customer_id,
        v_reservation_id
    from public.reservations as r
    where r.idempotency_key = trim(p_idempotency_key);

    -- If this idempotency key already created a reservation, return the
    -- existing booking records and existing blocking allocation.

    if v_reservation_id is not null then
        select j.id
        into v_delivery_job_id
        from public.service_jobs as j
        where j.reservation_id = v_reservation_id
          and j.job_type = 'delivery'
        order by j.created_at
        limit 1;

        select j.id
        into v_collection_job_id
        from public.service_jobs as j
        where j.reservation_id = v_reservation_id
          and j.job_type = 'collection'
        order by j.created_at
        limit 1;

        select
            a.id,
            a.machine_id
        into
            v_allocation_id,
            v_machine_id
        from public.allocations as a
        where a.reservation_id = v_reservation_id
          and a.status in ('held', 'reserved', 'active')
        order by a.created_at
        limit 1;

        return query
        select
            v_customer_id,
            v_reservation_id,
            v_delivery_job_id,
            v_collection_job_id,
            v_allocation_id,
            v_machine_id;

        return;
    end if;

    insert into public.customers (
        first_name,
        last_name,
        email,
        phone
    )
    values (
        p_first_name,
        p_last_name,
        p_email,
        nullif(p_phone, '')
    )
    returning id into v_customer_id;

    insert into public.reservations (
        customer_id,
        product_id,
        quantity,
        rental_start,
        rental_end,
        status,
        delivery_address_line_1,
        delivery_address_line_2,
        delivery_postcode,
        delivery_city,
        delivery_zone,
        weekly_price_at_booking,
        delivery_fee,
        options_total,
        deposit_amount,
        total_amount,
        payment_status,
        idempotency_key
    )
    values (
        v_customer_id,
        p_product_id,
        1,
        p_rental_start,
        p_rental_end,
        'pending',
        p_delivery_address_line_1,
        nullif(p_delivery_address_line_2, ''),
        p_delivery_postcode,
        p_delivery_city,
        p_delivery_zone,
        p_weekly_price_at_booking,
        p_delivery_fee,
        p_options_total,
        p_deposit_amount,
        p_total_amount,
        'not_started',
        trim(p_idempotency_key)
    )
    returning id into v_reservation_id;

    insert into public.service_jobs (
        reservation_id,
        job_type,
        scheduled_date,
        time_slot,
        address_line_1,
        address_line_2,
        postcode,
        city,
        status
    )
    values (
        v_reservation_id,
        'delivery',
        p_delivery_date,
        p_delivery_time_slot,
        p_delivery_address_line_1,
        nullif(p_delivery_address_line_2, ''),
        p_delivery_postcode,
        p_delivery_city,
        'scheduled'
    )
    returning id into v_delivery_job_id;

    insert into public.service_jobs (
        reservation_id,
        job_type,
        scheduled_date,
        time_slot,
        address_line_1,
        address_line_2,
        postcode,
        city,
        status
    )
    values (
        v_reservation_id,
        'collection',
        p_collection_date,
        p_collection_time_slot,
        p_delivery_address_line_1,
        nullif(p_delivery_address_line_2, ''),
        p_delivery_postcode,
        p_delivery_city,
        'scheduled'
    )
    returning id into v_collection_job_id;

    -- Hold an actual physical machine before the transaction can succeed.
    --
    -- If create_machine_hold raises "No eligible machine available",
    -- PostgreSQL rolls back everything created above.

    select
        h.allocation_id,
        h.machine_id
    into
        v_allocation_id,
        v_machine_id
    from public.create_machine_hold(
        v_reservation_id,
        v_operational_start,
        v_operational_end
    ) as h;

    if v_allocation_id is null
       or v_machine_id is null then
        raise exception 'machine hold was not created';
    end if;

    return query
    select
        v_customer_id,
        v_reservation_id,
        v_delivery_job_id,
        v_collection_job_id,
        v_allocation_id,
        v_machine_id;
end;
$$;

-- Reservation creation remains a trusted backend-only operation.

revoke all on function public.create_reservation_transaction(
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    text,
    text,
    text,
    text,
    text,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    date,
    text,
    date,
    text,
    text,
    timestamp without time zone,
    timestamp without time zone
)
from public;

grant execute on function public.create_reservation_transaction(
    text,
    text,
    text,
    text,
    text,
    timestamptz,
    timestamptz,
    text,
    text,
    text,
    text,
    text,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    date,
    text,
    date,
    text,
    text,
    timestamp without time zone,
    timestamp without time zone
)
to service_role;
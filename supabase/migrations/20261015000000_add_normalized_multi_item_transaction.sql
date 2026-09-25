-- MM3C: integrate the MM3B reservation-item allocator into the normalized
-- reservation transaction. The public Edge boundary remains single-item.

-- Legacy single-product snapshots cannot honestly represent a mixed basket.
-- NULL means that reservation_items are authoritative for those legacy fields.
alter table public.reservations
    alter column product_id drop not null,
    alter column weekly_price_at_booking drop not null;

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
    p_line_total numeric,
    p_items jsonb
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
    v_item jsonb;
    v_product_id text;
    v_quantity integer;
    v_unit_count integer := 0;
    v_raw_item_count integer;
    v_weekly_price numeric;
    v_deposit numeric;
    v_unit_line_total numeric;
    v_expected_rental_total numeric := 0;
    v_expected_total numeric;
    v_legacy_product_id text;
    v_legacy_weekly_price numeric;
    v_organisation_id uuid;
    v_customer_id uuid;
    v_reservation_id uuid;
    v_delivery_job_id uuid;
    v_collection_job_id uuid;
    v_allocation_id uuid;
    v_machine_id text;
    v_hold_expires_at timestamptz;
    v_capability_matched boolean := true;
    v_requested_items jsonb;
    v_existing_items jsonb;
    v_active_allocation_count integer;
    v_linked_allocation_count integer;
begin
    if p_capability_hash is null
       or p_capability_hash !~ '^\\x[0-9a-f]{64}$' then
        raise exception 'invalid payment capability hash' using errcode = '22023';
    end if;

    if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
        raise exception 'idempotency key is required' using errcode = '22023';
    end if;

    if p_operational_start is null
       or p_operational_end is null
       or p_operational_end <= p_operational_start then
        raise exception 'operational period is required' using errcode = '22023';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0
       or jsonb_array_length(p_items) > 8 then
        raise exception 'invalid reservation items' using errcode = '22023';
    end if;

    v_raw_item_count := jsonb_array_length(p_items);

    if exists (
        select 1
        from (
            select value ->> 'product_id' as product_id
            from jsonb_array_elements(p_items)
        ) as raw
        group by raw.product_id
        having count(*) > 1
    ) then
        raise exception 'duplicate reservation item product' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object'
           or v_item ?| array['product_id'] = false
           or v_item ?| array['quantity'] = false
           or (v_item - 'product_id' - 'quantity') <> '{}'::jsonb
           or nullif(trim(v_item ->> 'product_id'), '') is null
           or (v_item ->> 'quantity') !~ '^[1-9][0-9]*$' then
            raise exception 'invalid reservation item' using errcode = '22023';
        end if;

        v_product_id := trim(v_item ->> 'product_id');
        v_quantity := (v_item ->> 'quantity')::integer;
        if v_quantity <= 0 or v_unit_count + v_quantity > 8 then
            raise exception 'invalid reservation item quantity' using errcode = '22023';
        end if;

        select p.weekly_price, p.deposit_amount
        into v_weekly_price, v_deposit
        from public.products as p
        where p.id = v_product_id
          and p.active = true;
        if not found then
            raise exception 'invalid active product' using errcode = '22023';
        end if;

        v_unit_line_total := round(
            (v_weekly_price / 7)
            * greatest(3, (p_rental_end::date - p_rental_start::date))::numeric,
            2
        );
        v_expected_rental_total := v_expected_rental_total
            + (v_unit_line_total * v_quantity);
        v_unit_count := v_unit_count + v_quantity;
    end loop;

    select case when v_raw_item_count = 1 then min(raw.product_id) end,
           case when v_raw_item_count = 1 then min(raw.weekly_price) end
    into v_legacy_product_id, v_legacy_weekly_price
    from (
        select value ->> 'product_id' as product_id,
               p.weekly_price
        from jsonb_array_elements(p_items) as items(value)
        join public.products as p on p.id = items.value ->> 'product_id'
    ) as raw;

    -- A same-product quantity remains honestly representable in the legacy
    -- fields. A mixed basket deliberately leaves them NULL.
    if v_raw_item_count = 1 and v_unit_count = 1 then
        if p_product_id is distinct from v_legacy_product_id
           or p_weekly_price_at_booking is distinct from v_legacy_weekly_price
           or p_unit_rental_price is distinct from v_legacy_weekly_price
           or p_line_total is distinct from v_expected_rental_total then
            raise exception 'authoritative reservation pricing mismatch' using errcode = '22023';
        end if;
    elsif v_raw_item_count = 1 then
        if p_product_id is distinct from v_legacy_product_id
           or p_weekly_price_at_booking is distinct from v_legacy_weekly_price then
            raise exception 'authoritative reservation pricing mismatch' using errcode = '22023';
        end if;
    elsif p_product_id is not null or p_weekly_price_at_booking is not null
          or p_unit_rental_price is not null or p_line_total is not null then
        raise exception 'mixed reservation cannot use legacy product snapshot' using errcode = '22023';
    end if;

    if p_delivery_fee is null or p_delivery_fee < 0
       or p_options_total is null or p_options_total < 0 then
        raise exception 'invalid reservation fees' using errcode = '22023';
    end if;

    v_expected_total := round(
        v_expected_rental_total + p_delivery_fee + p_options_total,
        2
    );
    if p_total_amount is distinct from v_expected_total then
        raise exception 'authoritative reservation pricing mismatch' using errcode = '22023';
    end if;

    if v_unit_count > 1 and p_deposit_amount is not null then
        raise exception 'multi-item reservation deposit must be NULL' using errcode = '22023';
    end if;

    if p_deposit_amount is not null and v_raw_item_count = 1 then
        select p.deposit_amount
        into v_deposit
        from public.products as p
        where p.id = v_legacy_product_id
          and p.active = true;
        if p_deposit_amount is distinct from v_deposit then
            raise exception 'authoritative reservation pricing mismatch' using errcode = '22023';
        end if;
    end if;

    select jsonb_agg(
        jsonb_build_object(
            'product_id', x.product_id,
            'unit_rental_price', x.weekly_price,
            'line_total', x.unit_line_total
        ) order by x.product_id, x.unit_index
    )
    into v_requested_items
    from (
        select raw.value ->> 'product_id' as product_id,
               p.weekly_price,
               round(
                   (p.weekly_price / 7)
                   * greatest(3, (p_rental_end::date - p_rental_start::date))::numeric,
                   2
               ) as unit_line_total,
               units.unit_index
        from jsonb_array_elements(p_items) as raw(value)
        join public.products as p on p.id = raw.value ->> 'product_id'
        cross join lateral generate_series(
            1, (raw.value ->> 'quantity')::integer
        ) as units(unit_index)
    ) as x;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(trim(p_idempotency_key), 0)
    );

    select r.customer_id, r.id, r.organisation_id
    into v_customer_id, v_reservation_id, v_organisation_id
    from public.reservations as r
    where r.idempotency_key = trim(p_idempotency_key);

    if v_reservation_id is not null then
        select jsonb_agg(
            jsonb_build_object(
                'product_id', ri.product_id,
                'unit_rental_price', ri.unit_rental_price,
                'line_total', ri.line_total
            ) order by ri.product_id, ri.id
        )
        into v_existing_items
        from public.reservation_items as ri
        where ri.reservation_id = v_reservation_id
          and ri.organisation_id = v_organisation_id;

        if v_existing_items is distinct from v_requested_items then
            raise exception 'idempotency key payload conflict' using errcode = 'P0003';
        end if;

        if not exists (
            select 1
            from public.reservations as r
            left join public.service_jobs as dj
              on dj.reservation_id = r.id and dj.job_type = 'delivery'
            left join public.service_jobs as cj
              on cj.reservation_id = r.id and cj.job_type = 'collection'
            where r.id = v_reservation_id
              and r.product_id is not distinct from v_legacy_product_id
              and r.quantity = v_unit_count
              and r.rental_start is not distinct from p_rental_start
              and r.rental_end is not distinct from p_rental_end
              and r.delivery_zone is not distinct from p_delivery_zone
              and r.weekly_price_at_booking is not distinct from v_legacy_weekly_price
              and r.delivery_fee is not distinct from p_delivery_fee
              and r.options_total is not distinct from p_options_total
              and r.deposit_amount is not distinct from p_deposit_amount
              and r.total_amount is not distinct from p_total_amount
              and dj.scheduled_date is not distinct from p_delivery_date
              and dj.time_slot is not distinct from p_delivery_time_slot
              and cj.scheduled_date is not distinct from p_collection_date
              and cj.time_slot is not distinct from p_collection_time_slot
        ) then
            raise exception 'idempotency key payload conflict' using errcode = 'P0003';
        end if;

        select j.id into v_delivery_job_id
        from public.service_jobs as j
        where j.reservation_id = v_reservation_id and j.job_type = 'delivery'
        order by j.created_at limit 1;
        select j.id into v_collection_job_id
        from public.service_jobs as j
        where j.reservation_id = v_reservation_id and j.job_type = 'collection'
        order by j.created_at limit 1;
        select a.id, a.machine_id, a.hold_expires_at
        into v_allocation_id, v_machine_id, v_hold_expires_at
        from public.allocations as a
        where a.reservation_id = v_reservation_id
          and a.status in ('held', 'reserved', 'active')
        order by a.created_at, a.id limit 1;

        select c.capability_hash = lower(p_capability_hash)
        into v_capability_matched
        from public.reservation_payment_capabilities as c
        where c.reservation_id = v_reservation_id;
        v_capability_matched := coalesce(v_capability_matched, false);

        return query select v_customer_id, v_reservation_id, v_delivery_job_id,
            v_collection_job_id, v_allocation_id, v_machine_id,
            (select r.status from public.reservations as r where r.id = v_reservation_id),
            v_hold_expires_at, false, v_capability_matched;
        return;
    end if;

    select o.id
    into v_organisation_id
    from public.organisations as o
    where o.slug = 'igloue';
    if v_organisation_id is null then
        raise exception 'IGLOUE organisation not found';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'igloue:pending-contact-holds:' || v_organisation_id::text
            || ':' || lower(trim(p_email)), 0
        )
    );

    if (
        select count(*)
        from public.reservations as r
        join public.customers as c on c.id = r.customer_id
        where r.organisation_id = v_organisation_id
          and c.organisation_id = v_organisation_id
          and lower(trim(c.email)) = lower(trim(p_email))
          and r.status = 'pending'
          and exists (
              select 1 from public.allocations as a
              where a.reservation_id = r.id and a.status = 'held'
          )
    ) >= 2 then
        raise exception 'Too many active holds' using errcode = 'P1001';
    end if;

    insert into public.customers (
        organisation_id, first_name, last_name, email, phone
    ) values (
        v_organisation_id, p_first_name, p_last_name, p_email, nullif(p_phone, '')
    ) returning id into v_customer_id;

    insert into public.reservations (
        organisation_id, customer_id, product_id, quantity,
        rental_start, rental_end, status,
        delivery_address_line_1, delivery_address_line_2,
        delivery_postcode, delivery_city, delivery_zone,
        weekly_price_at_booking, delivery_fee, options_total,
        deposit_amount, total_amount, payment_status, idempotency_key
    ) values (
        v_organisation_id, v_customer_id, v_legacy_product_id, v_unit_count,
        p_rental_start, p_rental_end, 'pending',
        p_delivery_address_line_1, nullif(p_delivery_address_line_2, ''),
        p_delivery_postcode, p_delivery_city, p_delivery_zone,
        v_legacy_weekly_price, p_delivery_fee, p_options_total,
        p_deposit_amount, p_total_amount, 'not_started', trim(p_idempotency_key)
    ) returning id into v_reservation_id;

    insert into public.service_jobs (
        reservation_id, job_type, scheduled_date, time_slot,
        address_line_1, address_line_2, postcode, city, status
    ) values
        (v_reservation_id, 'delivery', p_delivery_date, p_delivery_time_slot,
         p_delivery_address_line_1, nullif(p_delivery_address_line_2, ''),
         p_delivery_postcode, p_delivery_city, 'scheduled'),
        (v_reservation_id, 'collection', p_collection_date, p_collection_time_slot,
         p_delivery_address_line_1, nullif(p_delivery_address_line_2, ''),
         p_delivery_postcode, p_delivery_city, 'scheduled');

    select j.id into v_delivery_job_id
    from public.service_jobs as j
    where j.reservation_id = v_reservation_id and j.job_type = 'delivery'
    order by j.created_at limit 1;
    select j.id into v_collection_job_id
    from public.service_jobs as j
    where j.reservation_id = v_reservation_id and j.job_type = 'collection'
    order by j.created_at limit 1;

    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    )
    select v_organisation_id, v_reservation_id,
           raw.value ->> 'product_id', p.weekly_price,
           round(
               (p.weekly_price / 7)
               * greatest(3, (p_rental_end::date - p_rental_start::date))::numeric,
               2
           )
    from jsonb_array_elements(p_items) as raw(value)
    join public.products as p on p.id = raw.value ->> 'product_id'
    cross join lateral generate_series(
        1, (raw.value ->> 'quantity')::integer
    ) as units(unit_index);

    select count(*)::integer,
           count(*) filter (where a.reservation_item_id is not null)::integer
    into v_active_allocation_count, v_linked_allocation_count
    from public.allocate_reservation_items(
        v_reservation_id,
        p_operational_start at time zone 'Europe/Paris',
        p_operational_end at time zone 'Europe/Paris'
    ) as a;

    if v_active_allocation_count <> v_unit_count
       or v_linked_allocation_count <> v_unit_count then
        raise exception 'Incomplete reservation allocation set' using errcode = 'P0001';
    end if;

    select a.id, a.machine_id, a.hold_expires_at
    into v_allocation_id, v_machine_id, v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = v_reservation_id and a.status = 'held'
    order by a.created_at, a.id limit 1;

    update public.reservations
    set recipient_first_name = p_recipient_first_name,
        recipient_last_name = p_recipient_last_name,
        recipient_phone = p_recipient_phone
    where id = v_reservation_id and organisation_id = v_organisation_id;

    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        company_name, billing_email, billing_address_line_1,
        billing_address_line_2, billing_postcode, billing_city,
        billing_country
    ) values (
        v_organisation_id, v_reservation_id, p_billing_mode, p_billing_name,
        p_billing_company_name, p_billing_email, p_billing_address_line_1,
        p_billing_address_line_2, p_billing_postcode, p_billing_city,
        p_billing_country
    );

    insert into public.reservation_payment_capabilities (
        organisation_id, reservation_id, capability_hash, expires_at
    ) values (
        v_organisation_id, v_reservation_id, lower(p_capability_hash),
        v_hold_expires_at
    );

    return query select v_customer_id, v_reservation_id, v_delivery_job_id,
        v_collection_job_id, v_allocation_id, v_machine_id,
        'pending'::text, v_hold_expires_at, true, true;
end;
$$;

revoke all on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone,
    text, text, text, text, text, text, text, text, text, text, text,
    text, numeric, numeric, jsonb
) from public, anon, authenticated;

grant execute on function public.create_reservation_with_payment_capability(
    text, text, text, text, text, text, timestamptz, timestamptz,
    text, text, text, text, text, numeric, numeric, numeric, numeric,
    numeric, date, text, date, text, text,
    timestamp without time zone, timestamp without time zone,
    text, text, text, text, text, text, text, text, text, text, text,
    text, numeric, numeric, jsonb
) to service_role;

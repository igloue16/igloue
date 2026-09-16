-- Add idempotency protection to reservation creation.
--
-- A client-generated idempotency key identifies one booking submission.
-- Retrying the same submission with the same key returns the records that
-- were already created instead of creating a duplicate reservation.
--
-- Existing reservations remain valid because idempotency_key is nullable.

alter table public.reservations
add column idempotency_key text;

alter table public.reservations
add constraint reservations_idempotency_key_not_blank
check (
  idempotency_key is null
  or length(trim(idempotency_key)) > 0
);

create unique index reservations_idempotency_key_unique
on public.reservations (idempotency_key)
where idempotency_key is not null;


-- Remove the original non-idempotent transaction function.
-- It is replaced below by the version requiring an idempotency key.

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
  p_idempotency_key text
)
returns table (
  customer_id uuid,
  reservation_id uuid,
  delivery_job_id uuid,
  collection_job_id uuid
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
begin
  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required';
  end if;

  -- Serialize requests using the same idempotency key.
  --
  -- This protects against two identical requests arriving concurrently.
  -- The second transaction waits for the first one to finish, then finds
  -- and returns the reservation created by the first transaction.
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

    return query
    select
      v_customer_id,
      v_reservation_id,
      v_delivery_job_id,
      v_collection_job_id;

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

  return query
  select
    v_customer_id,
    v_reservation_id,
    v_delivery_job_id,
    v_collection_job_id;
end;
$$;


-- The booking transaction is a privileged backend operation.
-- Browser-facing roles must not be able to execute it directly.

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
  text
) from public;

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
  text
) to service_role;
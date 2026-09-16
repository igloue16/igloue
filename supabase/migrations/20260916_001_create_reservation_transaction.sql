create or replace function public.create_reservation_transaction(
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
  p_collection_time_slot text
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
  /*
   * Create the customer.
   *
   * Customer deduplication is deliberately postponed.
   * For Milestone 1, each successful booking creates
   * the customer record required by that reservation.
   */
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

  /*
   * Create the pending reservation.
   *
   * Pricing values supplied to this function must come
   * from trusted server-side IGLOUE calculations, never
   * directly from browser-submitted pricing.
   */
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
    payment_status
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
    'not_started'
  )
  returning id into v_reservation_id;

  /*
   * Create the delivery service job.
   */
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

  /*
   * Create the collection service job.
   */
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

/*
 * This transaction is a privileged backend operation.
 *
 * Do not allow browser-facing anon/authenticated roles
 * to call it directly. The Edge Function will call it
 * through its server-side administrative database client
 * only after IGLOUE validation and pricing have succeeded.
 */
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
  text
) to service_role;
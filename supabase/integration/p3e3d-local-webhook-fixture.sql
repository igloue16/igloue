\if :cleanup
begin;

delete from public.outbox_events
where aggregate_type = 'reservation'
  and aggregate_id = '00000000-0000-4000-8000-00000000d301'::uuid
  and event_type = 'reservation.confirmed';

delete from public.payment_provider_events
where provider = 'stripe'
  and provider_event_id = 'evt_local_p3e3d_0001'
  and payment_attempt_id = '00000000-0000-4000-8000-00000000d302'::uuid;

delete from public.payment_attempts
where id = '00000000-0000-4000-8000-00000000d302'::uuid
  and reservation_id = '00000000-0000-4000-8000-00000000d301'::uuid
  and idempotency_key = 'p3e3d-local-webhook-attempt';

delete from public.service_jobs
where reservation_id = '00000000-0000-4000-8000-00000000d301'::uuid
  and id in (
    '00000000-0000-4000-8000-00000000d304'::uuid,
    '00000000-0000-4000-8000-00000000d305'::uuid
  );

delete from public.allocations
where id = '00000000-0000-4000-8000-00000000d303'::uuid
  and reservation_id = '00000000-0000-4000-8000-00000000d301'::uuid
  and machine_id = 'P3E3D-LOCAL-E2E-MACHINE';

delete from public.reservations
where id = '00000000-0000-4000-8000-00000000d301'::uuid
  and customer_id = '00000000-0000-4000-8000-00000000d306'::uuid
  and idempotency_key = 'p3e3d-local-webhook-reservation';

delete from public.customers
where id = '00000000-0000-4000-8000-00000000d306'::uuid
  and email = 'p3e3d-local-webhook@example.invalid';

delete from public.physical_machines
where id = 'P3E3D-LOCAL-E2E-MACHINE'
  and serial_number = 'P3E3D-LOCAL-E2E-SERIAL';

commit;
\else
begin;

do $$
begin
    if not exists (select 1 from public.organisations where slug = 'igloue') then
        raise exception 'required local organisation igloue is missing';
    end if;
    if not exists (select 1 from public.products where id = 'essential') then
        raise exception 'required local product essential is missing';
    end if;
    if exists (
        select 1
        from public.customers
        where id = '00000000-0000-4000-8000-00000000d306'::uuid
           or email = 'p3e3d-local-webhook@example.invalid'
    ) or exists (
        select 1 from public.reservations
        where id = '00000000-0000-4000-8000-00000000d301'::uuid
           or idempotency_key = 'p3e3d-local-webhook-reservation'
    ) or exists (
        select 1 from public.payment_attempts
        where id = '00000000-0000-4000-8000-00000000d302'::uuid
           or idempotency_key = 'p3e3d-local-webhook-attempt'
           or provider_checkout_session_id = 'cs_local_p3e3d_0001'
           or provider_payment_intent_id = 'pi_local_p3e3d_0001'
    ) or exists (
        select 1 from public.allocations
        where id = '00000000-0000-4000-8000-00000000d303'::uuid
    ) or exists (
        select 1 from public.service_jobs
        where id in (
            '00000000-0000-4000-8000-00000000d304'::uuid,
            '00000000-0000-4000-8000-00000000d305'::uuid
        )
    ) or exists (
        select 1 from public.physical_machines
        where id = 'P3E3D-LOCAL-E2E-MACHINE'
           or serial_number = 'P3E3D-LOCAL-E2E-SERIAL'
    ) or exists (
        select 1 from public.payment_provider_events
        where provider = 'stripe' and provider_event_id = 'evt_local_p3e3d_0001'
    ) then
        raise exception 'P3E3D deterministic fixture identifiers already exist';
    end if;
end;
$$;

insert into public.customers (id, organisation_id, first_name, last_name, email)
select '00000000-0000-4000-8000-00000000d306'::uuid, id,
       'P3E3D Local', 'Webhook', 'p3e3d-local-webhook@example.invalid'
from public.organisations where slug = 'igloue';

insert into public.physical_machines (id, product_id, serial_number, status, active)
values ('P3E3D-LOCAL-E2E-MACHINE', 'essential', 'P3E3D-LOCAL-E2E-SERIAL', 'available', true);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, quantity, rental_start, rental_end, status,
    delivery_address_line_1, delivery_postcode, delivery_city, weekly_price_at_booking,
    total_amount, payment_status, idempotency_key
)
select
    '00000000-0000-4000-8000-00000000d301'::uuid,
    o.id,
    '00000000-0000-4000-8000-00000000d306'::uuid,
    'essential', 1, '2047-01-01 12:00+00', '2047-01-08 12:00+00', 'pending',
    '1 P3E3D Local Test Street', '16000', 'Angouleme', 59.00,
    75.00, 'not_started', 'p3e3d-local-webhook-reservation'
from public.organisations as o where o.slug = 'igloue';

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at
)
values (
    '00000000-0000-4000-8000-00000000d303'::uuid,
    '00000000-0000-4000-8000-00000000d301'::uuid,
    'P3E3D-LOCAL-E2E-MACHINE', 'held', '2047-01-01 12:00+00', '2047-01-08 12:00+00',
    now() + interval '2 days'
);

insert into public.service_jobs (
    id, reservation_id, job_type, scheduled_date, time_slot,
    address_line_1, postcode, city, status
)
values
    ('00000000-0000-4000-8000-00000000d304'::uuid,
     '00000000-0000-4000-8000-00000000d301'::uuid,
     'delivery', '2047-01-01', '0830-1030', '1 P3E3D Local Test Street', '16000', 'Angouleme', 'scheduled'),
    ('00000000-0000-4000-8000-00000000d305'::uuid,
     '00000000-0000-4000-8000-00000000d301'::uuid,
     'collection', '2047-01-08', '1630-1830', '1 P3E3D Local Test Street', '16000', 'Angouleme', 'scheduled');

insert into public.payment_attempts (
    id, organisation_id, reservation_id, provider, purpose, amount, currency, status,
    idempotency_key, provider_checkout_session_id, provider_payment_intent_id
)
select
    '00000000-0000-4000-8000-00000000d302'::uuid, o.id,
    '00000000-0000-4000-8000-00000000d301'::uuid,
    'stripe', 'rental', 75.00, 'EUR', 'checkout_open',
    'p3e3d-local-webhook-attempt', 'cs_local_p3e3d_0001', null
from public.organisations as o where o.slug = 'igloue';

commit;
\endif

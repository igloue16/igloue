-- P3E6B: narrow, read-only queue for unresolved paid payment exceptions.
-- Authority comes from the existing exception, attempt, reservation, and event
-- records; no caller-supplied tenant or payment filters are accepted.
create function public.list_unresolved_paid_payment_exceptions(
    p_limit integer default 25
)
returns table (
    exception_id uuid,
    organisation_id uuid,
    reservation_id uuid,
    payment_attempt_id uuid,
    source_provider_event_id uuid,
    created_at timestamptz,
    reason_code text,
    exception_status text,
    customer_id uuid,
    customer_name text,
    customer_email text,
    customer_phone text,
    amount numeric,
    currency text
)
language sql
security invoker
set search_path = ''
as $$
    select e.id,
           e.organisation_id,
           r.id,
           pa.id,
           pe.id,
           e.created_at,
           e.reason_code,
           e.status,
           c.id,
           coalesce(
               nullif(concat_ws(' ', nullif(trim(r.recipient_first_name), ''),
                                     nullif(trim(r.recipient_last_name), '')), ''),
               nullif(trim(bd.billing_name), ''),
               concat_ws(' ', c.first_name, c.last_name)
           ),
           c.email,
           coalesce(r.recipient_phone, c.phone),
           pa.amount,
           pa.currency
    from public.payment_exceptions as e
    join public.reservations as r
      on r.id = e.reservation_id
     and r.organisation_id = e.organisation_id
    join public.payment_attempts as pa
      on pa.id = e.payment_attempt_id
     and pa.reservation_id = e.reservation_id
     and pa.organisation_id = e.organisation_id
    join public.customers as c
      on c.id = r.customer_id
     and c.organisation_id = r.organisation_id
    left join public.reservation_billing_details as bd
      on bd.reservation_id = r.id
     and bd.organisation_id = r.organisation_id
    join public.payment_provider_events as pe
      on pe.id = e.source_provider_event_id
     and pe.payment_attempt_id = pa.id
     and pe.organisation_id = e.organisation_id
    where e.status = 'unresolved'
      and e.resolution is null
      and e.resolved_at is null
      and pa.status = 'requires_review'
      and pa.paid_at is not null
      and r.payment_status = 'requires_review'
      and pe.provider = 'stripe'
      and pe.event_type = 'checkout.session.completed'
      and pe.status = 'processed'
      and pe.processed_at is not null
      and pe.matched_at is not null
      and pe.conflict_detected_at is null
      and pe.payload_sha256 is not null
      and pe.livemode is not null
    order by e.created_at asc, e.id asc
    limit least(greatest(coalesce(p_limit, 25), 1), 50);
$$;

revoke all on function public.list_unresolved_paid_payment_exceptions(integer)
from public, anon, authenticated;
grant execute on function public.list_unresolved_paid_payment_exceptions(integer)
to service_role;


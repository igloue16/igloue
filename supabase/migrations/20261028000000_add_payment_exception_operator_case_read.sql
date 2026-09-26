-- Minimal service-only case context for the trusted payment operator API.
-- Supports inspection and retry-safe resolution without customer contact or
-- provider payload data.
create function public.get_payment_exception_operator_case(p_exception_id uuid)
returns table (
    exception_id uuid,
    organisation_id uuid,
    reservation_id uuid,
    payment_attempt_id uuid,
    created_at timestamptz,
    reason_code text,
    exception_status text,
    resolution text,
    resolved_at timestamptz,
    reservation_payment_status text,
    attempt_status text,
    paid_at timestamptz,
    amount numeric,
    currency text
)
language sql
security invoker
set search_path = ''
as $$
    select e.id, e.organisation_id, r.id, pa.id, e.created_at, e.reason_code,
           e.status, e.resolution, e.resolved_at, r.payment_status, pa.status,
           pa.paid_at, pa.amount, pa.currency
    from public.payment_exceptions as e
    join public.reservations as r
      on r.id = e.reservation_id and r.organisation_id = e.organisation_id
    join public.payment_attempts as pa
      on pa.id = e.payment_attempt_id
     and pa.reservation_id = r.id and pa.organisation_id = r.organisation_id
    where e.id = p_exception_id
      and pa.paid_at is not null and pa.status = 'requires_review'
      and r.payment_status = 'requires_review'
      and e.status in ('unresolved', 'resolved')
      and ((e.status = 'unresolved' and e.resolution is null and e.resolved_at is null)
        or (e.status = 'resolved' and e.resolution is not null and e.resolved_at is not null));
$$;

revoke all on function public.get_payment_exception_operator_case(uuid)
from public, anon, authenticated;
grant execute on function public.get_payment_exception_operator_case(uuid)
to service_role;

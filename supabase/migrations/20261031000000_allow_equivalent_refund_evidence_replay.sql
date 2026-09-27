-- Provider observations may arrive after an equivalent refund has already
-- been finalized through another trusted path. Preserve the original attempt
-- evidence and audit actor; treat matching financial facts as a no-op.
create or replace function public.record_payment_refund_attempt_evidence(
  p_provider_attempt_id uuid,p_organisation_id uuid,p_provider_refund_id text,p_evidence_outcome text,
  p_evidence_source text,p_actor_source text,p_actor_id text,p_idempotency_key uuid
)
returns table(refund_id uuid,provider_attempt_id uuid,outcome text,finalized_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare initial_a public.payment_refund_attempts%rowtype; a public.payment_refund_attempts%rowtype;
  f public.payment_refunds%rowtype; r public.reservations%rowtype; p public.payment_attempts%rowtype; t timestamptz:=clock_timestamp();
begin
  if p_provider_attempt_id is null or p_organisation_id is null or p_idempotency_key is null
   or p_provider_refund_id is null or length(trim(p_provider_refund_id)) not between 1 and 255 or p_provider_refund_id<>trim(p_provider_refund_id)
   or p_evidence_outcome not in ('succeeded','failed') or p_evidence_source not in ('stripe_api','stripe_dashboard_reconciliation')
   or p_actor_source not in ('admin_tool','operator_tool') or p_actor_id is null or length(trim(p_actor_id)) not between 1 and 255 or p_actor_id<>trim(p_actor_id)
  then raise exception 'invalid refund evidence' using errcode='22023'; end if;
  select ra.* into initial_a from public.payment_refund_attempts ra where ra.id=p_provider_attempt_id;
  if not found then raise exception 'payment refund attempt unavailable' using errcode='P0002'; end if;
  select pr.* into f from public.payment_refunds pr where pr.id=initial_a.refund_id and pr.organisation_id=p_organisation_id;
  if not found then raise exception 'payment refund attempt unavailable' using errcode='P0002'; end if;
  select rs.* into r from public.reservations rs where rs.id=f.reservation_id and rs.organisation_id=p_organisation_id for update;
  if not found then raise exception 'payment refund attempt unavailable' using errcode='P0002'; end if;
  select pa.* into p from public.payment_attempts pa where pa.id=f.payment_attempt_id and pa.reservation_id=r.id and pa.organisation_id=p_organisation_id for update;
  if not found then raise exception 'payment refund attempt unavailable' using errcode='P0002'; end if;
  select pr.* into f from public.payment_refunds pr where pr.id=f.id and pr.organisation_id=p_organisation_id for update;
  select ra.* into a from public.payment_refund_attempts ra where ra.id=p_provider_attempt_id and ra.refund_id=f.id for update;
  if not found then raise exception 'payment refund attempt unavailable' using errcode='P0002'; end if;

  if a.status<>'prepared' then
    if a.provider_refund_id=p_provider_refund_id and f.provider_refund_id=p_provider_refund_id
      and a.status=p_evidence_outcome and p.paid_at is not null
      and p.amount=f.amount and p.currency=f.currency
      and ((p_evidence_outcome='succeeded' and f.status='succeeded' and f.obligation_status='satisfied'
            and p.status='refunded' and p.refunded_at is not null and r.payment_status='refunded')
        or (p_evidence_outcome='failed' and f.status in ('prepared','failed') and f.obligation_status='open'
            and p.status='requires_review' and p.refunded_at is null and r.payment_status='requires_review')) then
      -- Source/actor/idempotency metadata on this append-only attempt describes
      -- the observation that finalized it. A later provider event remains
      -- independently visible in the durable provider receipt/reconciliation rows.
      return query select f.id,a.id,'already_recorded'::text,a.finalized_at; return;
    end if;
    raise exception 'refund evidence conflicts with recorded attempt' using errcode='P0001';
  end if;
  if exists(select 1 from public.payment_refunds pr where pr.provider_refund_id=p_provider_refund_id and pr.id<>f.id) then
    raise exception 'provider refund ID is already linked to another obligation' using errcode='P0001'; end if;
  if f.obligation_status<>'open' or p.status<>'requires_review' or p.paid_at is null or r.payment_status<>'requires_review'
    or p.amount<>f.amount or p.currency<>f.currency then raise exception 'payment state is inconsistent with refund obligation' using errcode='P0001'; end if;
  update public.payment_refund_attempts set status=p_evidence_outcome,provider_refund_id=p_provider_refund_id,
    evidence_source=p_evidence_source,evidence_actor_source=p_actor_source,evidence_actor=p_actor_id,
    evidence_idempotency_key=p_idempotency_key,finalized_at=t where id=a.id and status='prepared';
  if not found then raise exception 'refund attempt changed' using errcode='40001'; end if;
  if p_evidence_outcome='succeeded' then
    update public.payment_refunds set status='succeeded',obligation_status='satisfied',provider_refund_id=p_provider_refund_id,
      evidence_outcome='succeeded',evidence_source=p_evidence_source,evidence_actor_source=p_actor_source,evidence_actor=p_actor_id,
      evidence_idempotency_key=p_idempotency_key,evidence_recorded_at=t,finalized_at=t,updated_at=t where id=f.id;
    update public.payment_attempts set status='refunded',refunded_at=t,updated_at=t where id=p.id and status='requires_review';
    if not found then raise exception 'payment attempt changed during refund finalization' using errcode='40001'; end if;
    update public.reservations set payment_status='refunded',updated_at=t where id=r.id and payment_status='requires_review';
    if not found then raise exception 'reservation payment state changed' using errcode='40001'; end if;
  end if;
  insert into public.payment_refund_history(refund_id,organisation_id,reservation_id,payment_attempt_id,action,previous_status,resulting_status,
    provider_refund_id,evidence_outcome,evidence_source,actor_source,actor_id,idempotency_key,occurred_at)
  values(f.id,f.organisation_id,f.reservation_id,f.payment_attempt_id,p_evidence_outcome,'prepared',p_evidence_outcome,
    p_provider_refund_id,p_evidence_outcome,p_evidence_source,p_actor_source,p_actor_id,p_idempotency_key,t);
  return query select f.id,a.id,p_evidence_outcome,t;
end $$;

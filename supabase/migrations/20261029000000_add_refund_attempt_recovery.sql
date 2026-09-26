-- P3E8: separate the durable refund obligation from individual Stripe attempts.
alter table public.payment_refunds add column obligation_status text not null default 'open';
alter table public.payment_refunds add constraint payment_refunds_obligation_status_check
  check (obligation_status in ('open','satisfied'));
update public.payment_refunds set obligation_status='satisfied' where status='succeeded';

create table public.payment_refund_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.payment_refunds(id),
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('prepared','succeeded','failed')),
  preparation_idempotency_key uuid not null,
  prepared_source text not null check (prepared_source in ('admin_tool','operator_tool')),
  prepared_actor text not null check (length(trim(prepared_actor)) between 1 and 255 and prepared_actor=trim(prepared_actor)),
  provider_refund_id text,
  evidence_source text,
  evidence_actor_source text,
  evidence_actor text,
  evidence_idempotency_key uuid,
  prepared_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint payment_refund_attempt_terminal_check check (
    (status='prepared' and provider_refund_id is null and evidence_source is null
      and evidence_actor_source is null and evidence_actor is null
      and evidence_idempotency_key is null and finalized_at is null)
    or (status in ('succeeded','failed') and provider_refund_id is not null
      and evidence_source in ('stripe_api','stripe_dashboard_reconciliation')
      and evidence_actor_source in ('admin_tool','operator_tool') and evidence_actor is not null
      and evidence_idempotency_key is not null and finalized_at is not null)
  ),
  unique(refund_id,attempt_number), unique(refund_id,preparation_idempotency_key)
);
create unique index payment_refund_attempt_provider_identity_idx
  on public.payment_refund_attempts(provider_refund_id) where provider_refund_id is not null;
create unique index payment_refund_attempt_active_idx
  on public.payment_refund_attempts(refund_id) where status='prepared';
create unique index payment_refund_attempt_success_idx
  on public.payment_refund_attempts(refund_id) where status='succeeded';
alter table public.payment_refund_attempts enable row level security;
revoke all on public.payment_refund_attempts from public,anon,authenticated,service_role;
grant select on public.payment_refund_attempts to service_role;
create function public.guard_payment_refund_attempt_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'payment refund attempts are append-only' using errcode='42501'; end if;
  if old.status<>'prepared' or new.id<>old.id or new.refund_id<>old.refund_id or new.attempt_number<>old.attempt_number
    or new.preparation_idempotency_key<>old.preparation_idempotency_key or new.prepared_source<>old.prepared_source
    or new.prepared_actor<>old.prepared_actor or new.prepared_at<>old.prepared_at or new.created_at<>old.created_at
    or new.status not in ('succeeded','failed') then
    raise exception 'payment refund attempt history is immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger payment_refund_attempts_append_only before update or delete on public.payment_refund_attempts
for each row execute function public.guard_payment_refund_attempt_history();
revoke all on function public.guard_payment_refund_attempt_history() from public,anon,authenticated;

-- Backfill immutable first-attempt evidence before enabling new-attempt creation.
insert into public.payment_refund_attempts(
  id,refund_id,attempt_number,status,preparation_idempotency_key,prepared_source,prepared_actor,
  provider_refund_id,evidence_source,evidence_actor_source,evidence_actor,evidence_idempotency_key,
  prepared_at,finalized_at,created_at
)
select gen_random_uuid(),pr.id,1,pr.status,pr.preparation_idempotency_key,pr.prepared_source,pr.prepared_actor,
  pr.provider_refund_id,pr.evidence_source,pr.evidence_actor_source,pr.evidence_actor,pr.evidence_idempotency_key,
  pr.prepared_at,pr.finalized_at,pr.created_at
from public.payment_refunds pr;

-- Keep direct trusted obligation inserts compatible while guaranteeing attempt 1 exists.
create function public.create_initial_payment_refund_attempt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.payment_refund_attempts(refund_id,attempt_number,status,preparation_idempotency_key,prepared_source,prepared_actor,
    provider_refund_id,evidence_source,evidence_actor_source,evidence_actor,evidence_idempotency_key,prepared_at,finalized_at,created_at)
  values(new.id,1,new.status,new.preparation_idempotency_key,new.prepared_source,new.prepared_actor,new.provider_refund_id,
    new.evidence_source,new.evidence_actor_source,new.evidence_actor,new.evidence_idempotency_key,new.prepared_at,new.finalized_at,new.created_at);
  return new;
end $$;
create trigger payment_refund_initial_attempt after insert on public.payment_refunds
for each row execute function public.create_initial_payment_refund_attempt();
revoke all on function public.create_initial_payment_refund_attempt() from public,anon,authenticated;

alter table public.payment_refund_history drop constraint payment_refund_history_action_check;
alter table public.payment_refund_history add constraint payment_refund_history_action_check check (
  (action='prepared' and previous_status='none' and resulting_status='prepared'
    and provider_refund_id is null and evidence_outcome is null and evidence_source is null)
  or (action='replacement_prepared' and previous_status='failed' and resulting_status='prepared'
    and provider_refund_id is null and evidence_outcome is null and evidence_source is null)
  or (action in ('succeeded','failed') and previous_status='prepared' and resulting_status=action
    and provider_refund_id is not null and evidence_outcome=action
    and evidence_source in ('stripe_api','stripe_dashboard_reconciliation'))
);

-- Existing callers continue to prepare the first attempt; subsequent calls create a replacement
-- only after an authoritative failed attempt. The obligation row is never duplicated.
drop function public.prepare_payment_refund(uuid,uuid,text,text,uuid);
create function public.prepare_payment_refund(
  p_exception_id uuid,p_organisation_id uuid,p_actor_source text,p_actor_id text,p_idempotency_key uuid
)
returns table(refund_id uuid,outcome text,amount numeric,currency text,prepared_at timestamptz,provider_attempt_id uuid)
language plpgsql security definer set search_path='' as $$
declare e public.payment_exceptions%rowtype; r public.reservations%rowtype; p public.payment_attempts%rowtype;
  f public.payment_refunds%rowtype; a public.payment_refund_attempts%rowtype; now_at timestamptz:=clock_timestamp(); n integer;
begin
  if p_exception_id is null or p_organisation_id is null or p_idempotency_key is null
    or p_actor_source not in ('admin_tool','operator_tool') or p_actor_source is null
    or p_actor_id is null or length(trim(p_actor_id)) not between 1 and 255 or p_actor_id<>trim(p_actor_id) then
    raise exception 'invalid refund preparation request' using errcode='22023'; end if;
  select * into e from public.payment_exceptions where id=p_exception_id and organisation_id=p_organisation_id;
  if not found then raise exception 'payment exception unavailable' using errcode='P0002'; end if;
  select * into r from public.reservations where id=e.reservation_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'payment exception unavailable' using errcode='P0002'; end if;
  select * into p from public.payment_attempts where id=e.payment_attempt_id and reservation_id=r.id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'payment exception unavailable' using errcode='P0002'; end if;
  select * into e from public.payment_exceptions where id=p_exception_id and organisation_id=p_organisation_id
    and reservation_id=r.id and payment_attempt_id=p.id for update;
  if not found then raise exception 'payment exception unavailable' using errcode='P0002'; end if;
  select * into f from public.payment_refunds where payment_exception_id=e.id for update;
  if found then
    select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.preparation_idempotency_key=p_idempotency_key;
    if found then
      if a.prepared_source=p_actor_source and a.prepared_actor=p_actor_id then
        return query select f.id,(case when a.status='prepared' then 'already_prepared' when a.status='failed' then 'already_failed' else 'already_satisfied' end)::text,
          f.amount,f.currency,a.prepared_at,a.id; return;
      end if;
      raise exception 'refund preparation replay conflicts' using errcode='P0001';
    end if;
    if f.obligation_status<>'open' or exists(select 1 from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status in ('prepared','succeeded'))
       or not exists(select 1 from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='failed')
       or p.status='refunded' or p.refunded_at is not null or r.payment_status='refunded'
       or e.status<>'resolved' or e.resolution<>'refund_required' or p.provider<>'stripe'
       or p.amount<>f.amount or p.currency<>f.currency or p.amount<>r.total_amount then
      raise exception 'refund replacement is not eligible' using errcode='P0001'; end if;
    select coalesce(max(ra.attempt_number),0)+1 into n from public.payment_refund_attempts ra where ra.refund_id=f.id;
    insert into public.payment_refund_attempts(refund_id,attempt_number,status,preparation_idempotency_key,prepared_source,prepared_actor,prepared_at)
      values(f.id,n,'prepared',p_idempotency_key,p_actor_source,p_actor_id,now_at) returning * into a;
    insert into public.payment_refund_history(refund_id,organisation_id,reservation_id,payment_attempt_id,action,previous_status,resulting_status,actor_source,actor_id,idempotency_key,occurred_at)
      values(f.id,f.organisation_id,f.reservation_id,f.payment_attempt_id,'replacement_prepared','failed','prepared',p_actor_source,p_actor_id,p_idempotency_key,now_at);
    return query select f.id,'prepared'::text,f.amount,f.currency,now_at,a.id; return;
  end if;
  if e.status<>'resolved' or e.resolution<>'refund_required' or p.provider<>'stripe' or p.purpose<>'rental'
    or p.status<>'requires_review' or p.paid_at is null or r.payment_status<>'requires_review'
    or p.currency<>'EUR' or p.amount<=0 or p.amount<>r.total_amount then
    raise exception 'payment is not eligible for refund preparation' using errcode='P0001'; end if;
  insert into public.payment_refunds(organisation_id,reservation_id,payment_attempt_id,payment_exception_id,amount,currency,
    resolution_source,resolution_actor,prepared_source,prepared_actor,preparation_idempotency_key,prepared_at,created_at,updated_at)
  values(p_organisation_id,r.id,p.id,e.id,p.amount,p.currency,e.resolver_source,e.resolver_actor,p_actor_source,p_actor_id,p_idempotency_key,now_at,now_at,now_at)
  returning * into f;
  select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='prepared';
  if not found then raise exception 'initial refund attempt unavailable' using errcode='P0001'; end if;
  insert into public.payment_refund_history(refund_id,organisation_id,reservation_id,payment_attempt_id,action,previous_status,resulting_status,actor_source,actor_id,idempotency_key,occurred_at)
    values(f.id,f.organisation_id,f.reservation_id,f.payment_attempt_id,'prepared','none','prepared',p_actor_source,p_actor_id,p_idempotency_key,now_at);
  return query select f.id,'prepared'::text,f.amount,f.currency,now_at,a.id;
end $$;

create function public.record_payment_refund_attempt_evidence(
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
    if a.provider_refund_id=p_provider_refund_id and a.status=p_evidence_outcome and a.evidence_source=p_evidence_source
      and a.evidence_actor_source=p_actor_source and a.evidence_actor=p_actor_id and a.evidence_idempotency_key=p_idempotency_key then
      return query select f.id,a.id,'already_recorded'::text,a.finalized_at; return;
    end if;
    raise exception 'refund evidence conflicts with recorded attempt' using errcode='P0001'; end if;
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

-- Preserve the prior service RPC contract for internal callers while routing to the active attempt.
drop function public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid);
create function public.record_payment_refund_evidence(
 p_refund_id uuid,p_organisation_id uuid,p_provider_refund_id text,p_evidence_outcome text,
 p_evidence_source text,p_actor_source text,p_actor_id text,p_idempotency_key uuid
) returns table(refund_id uuid,outcome text,finalized_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare a public.payment_refund_attempts%rowtype; result record;
begin
 select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=p_refund_id and ra.status='prepared';
 if not found then
   select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=p_refund_id and ra.provider_refund_id=p_provider_refund_id;
 end if;
 if not found then raise exception 'active refund attempt unavailable' using errcode='P0001'; end if;
 select * into result from public.record_payment_refund_attempt_evidence(a.id,p_organisation_id,p_provider_refund_id,p_evidence_outcome,p_evidence_source,p_actor_source,p_actor_id,p_idempotency_key);
 return query select result.refund_id,result.outcome,result.finalized_at;
end $$;

drop function public.get_payment_refund_execution(uuid);
create function public.get_payment_refund_execution(p_refund_id uuid)
returns table(refund_id uuid,organisation_id uuid,provider text,refund_status text,refund_amount numeric,refund_currency text,
 payment_attempt_id uuid,payment_intent_id text,attempt_status text,attempt_amount numeric,attempt_currency text,attempt_paid_at timestamptz,
 attempt_refunded_at timestamptz,reservation_payment_status text,reservation_status text,exception_status text,exception_resolution text,
 source_provider_event_id uuid,source_event_matched_at timestamptz,provider_attempt_id uuid,provider_attempt_number integer)
language plpgsql security definer set search_path='' as $$
declare f public.payment_refunds%rowtype; r public.reservations%rowtype; p public.payment_attempts%rowtype; e public.payment_exceptions%rowtype;
 ev public.payment_provider_events%rowtype; a public.payment_refund_attempts%rowtype;
begin
 select pr.* into f from public.payment_refunds pr where pr.id=p_refund_id;
 if not found then raise exception 'payment refund unavailable' using errcode='P0002'; end if;
 select rs.* into r from public.reservations rs where rs.id=f.reservation_id and rs.organisation_id=f.organisation_id for update;
 select pa.* into p from public.payment_attempts pa where pa.id=f.payment_attempt_id and pa.reservation_id=r.id and pa.organisation_id=r.organisation_id for update;
 select px.* into e from public.payment_exceptions px where px.id=f.payment_exception_id and px.organisation_id=r.organisation_id and px.reservation_id=r.id and px.payment_attempt_id=p.id for update;
 select pr.* into f from public.payment_refunds pr where pr.id=p_refund_id for update;
 select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='prepared' for update;
 select ppe.* into ev from public.payment_provider_events ppe where ppe.id=e.source_provider_event_id;
 if not found or f.obligation_status<>'open' or a.id is null or e.status<>'resolved' or e.resolution<>'refund_required'
   or p.provider<>'stripe' or p.purpose<>'rental' or p.status<>'requires_review' or p.paid_at is null or p.refunded_at is not null
   or p.amount<>f.amount or p.currency<>f.currency or p.amount<>r.total_amount or r.payment_status<>'requires_review'
   or p.provider_payment_intent_id is null or ev.status<>'processed' or ev.matched_at is null or ev.conflict_detected_at is not null then
   raise exception 'payment refund is not executable' using errcode='P0001'; end if;
 return query select f.id,f.organisation_id,f.provider,'prepared'::text,f.amount,f.currency,p.id,p.provider_payment_intent_id,
   p.status,p.amount,p.currency,p.paid_at,p.refunded_at,r.payment_status,r.status,e.status,e.resolution,ev.id,ev.matched_at,a.id,a.attempt_number;
end $$;

revoke all on function public.prepare_payment_refund(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_payment_refund(uuid,uuid,text,text,uuid) to service_role;
revoke all on function public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_payment_refund_evidence(uuid,uuid,text,text,text,text,text,uuid) to service_role;
revoke all on function public.record_payment_refund_attempt_evidence(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_payment_refund_attempt_evidence(uuid,uuid,text,text,text,text,text,uuid) to service_role;
revoke all on function public.get_payment_refund_execution(uuid) from public,anon,authenticated;
grant execute on function public.get_payment_refund_execution(uuid) to service_role;

-- Resolve business rows first, then the receipt rows. This matches preparation/evidence
-- ordering and also allows an authenticated Dashboard refund to be learned safely.
create or replace function public.apply_payment_refund_provider_event(p_event_id uuid)
returns table(outcome text,refund_id uuid)
language plpgsql security definer set search_path='' as $$
declare pe public.payment_provider_events%rowtype; re public.payment_refund_provider_events%rowtype;
 f public.payment_refunds%rowtype; r public.reservations%rowtype; p public.payment_attempts%rowtype;
 e public.payment_exceptions%rowtype; a public.payment_refund_attempts%rowtype;
 result record; target_id uuid; evidence_result text; evidence_status text; error_code text; is_external boolean:=false;
 now_at timestamptz:=clock_timestamp();
begin
 if p_event_id is null then raise exception 'refund event unavailable' using errcode='P0002'; end if;
 -- Discovery reads are deliberately unlocked; stable business rows are locked before receipts.
 select * into pe from public.payment_provider_events where id=p_event_id and provider='stripe'
  and event_type in ('refund.created','refund.updated','refund.failed');
 if not found then raise exception 'refund event unavailable' using errcode='P0002'; end if;
 select * into re from public.payment_refund_provider_events where receipt_event_id=p_event_id;
 if not found then raise exception 'normalized refund event unavailable' using errcode='P0002'; end if;
 if re.processing_status='processed' then
   return query select 'already_processed'::text,re.matched_payment_refund_id; return;
 elsif re.processing_status='ignored' or pe.status='ignored' or pe.conflict_detected_at is not null then
   return query select coalesce(re.processing_outcome,'ignored')::text,re.matched_payment_refund_id; return;
 elsif pe.status<>'received' or re.processing_status<>'received' or pe.livemode is null
   or pe.payload_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'refund event receipt is inconsistent' using errcode='P0001'; end if;
 if re.refund_status in ('pending','requires_action') then
   update public.payment_refund_provider_events set processing_status='ignored',processing_outcome='pending' where receipt_event_id=p_event_id;
   update public.payment_provider_events set status='ignored',last_error_code='refund_not_eligible' where id=p_event_id;
   return query select 'pending'::text,null::uuid; return;
 end if;
 select pr.id into target_id from public.payment_refund_attempts ra join public.payment_refunds pr on pr.id=ra.refund_id
   where ra.provider_refund_id=re.provider_refund_id;
 if target_id is null and re.payment_intent_id is not null then
   select pr.id into target_id from public.payment_refunds pr join public.payment_attempts pa
    on pa.id=pr.payment_attempt_id and pa.reservation_id=pr.reservation_id and pa.organisation_id=pr.organisation_id
   where pr.provider='stripe' and pr.obligation_status='open' and pa.provider='stripe'
    and pa.provider_payment_intent_id=re.payment_intent_id
    and exists(select 1 from public.payment_exceptions x where x.id=pr.payment_exception_id and x.status='resolved' and x.resolution='refund_required')
   order by pr.created_at limit 1;
 end if;
 if target_id is null then
   update public.payment_refund_provider_events set processing_status='ignored',processing_outcome='ignored',processing_error_code='refund_unknown' where receipt_event_id=p_event_id;
   update public.payment_provider_events set status='ignored',last_error_code='refund_unknown' where id=p_event_id;
   return query select 'ignored'::text,null::uuid; return;
 end if;
 select pr.* into f from public.payment_refunds pr where pr.id=target_id;
 if not found then raise exception 'refund obligation unavailable' using errcode='P0002'; end if;
 select rs.* into r from public.reservations rs where rs.id=f.reservation_id and rs.organisation_id=f.organisation_id for update;
 if not found then raise exception 'refund obligation unavailable' using errcode='P0002'; end if;
 select pa.* into p from public.payment_attempts pa where pa.id=f.payment_attempt_id and pa.reservation_id=r.id and pa.organisation_id=r.organisation_id for update;
 if not found then raise exception 'refund obligation unavailable' using errcode='P0002'; end if;
 select px.* into e from public.payment_exceptions px where px.id=f.payment_exception_id and px.organisation_id=r.organisation_id and px.reservation_id=r.id and px.payment_attempt_id=p.id for update;
 select pr.* into f from public.payment_refunds pr where pr.id=target_id and pr.organisation_id=r.organisation_id and pr.reservation_id=r.id and pr.payment_attempt_id=p.id for update;
 select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.provider_refund_id=re.provider_refund_id for update;
 if not found then select ra.* into a from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='prepared' for update; end if;
 if f.amount*100<>re.amount_cents then
   error_code:='refund_amount_mismatch';
 elsif f.currency<>'EUR' or re.currency<>'eur' then
   error_code:='refund_currency_mismatch';
 elsif re.payment_intent_id is not null and p.provider_payment_intent_id<>re.payment_intent_id then
   error_code:='refund_payment_intent_mismatch';
 elsif a.id is not null and a.status<>'prepared' and
    (a.provider_refund_id<>re.provider_refund_id or a.status<>case when re.refund_status='succeeded' then 'succeeded' else 'failed' end) then
   error_code:='refund_evidence_conflict';
 elsif a.id is not null and a.status<>'prepared' then
   error_code:=null;
 elsif f.obligation_status<>'open' or p.provider<>'stripe' or p.status<>'requires_review' or p.paid_at is null
   or r.payment_status<>'requires_review' or e.status<>'resolved' or e.resolution<>'refund_required' then
   error_code:='refund_not_eligible';
 elsif a.id is null and exists(select 1 from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='prepared') then
   error_code:='refund_not_eligible';
 elsif a.id is null and not exists(select 1 from public.payment_refund_attempts ra where ra.refund_id=f.id and ra.status='failed') then
   error_code:='refund_not_eligible';
 else error_code:=null; end if;
 if error_code is not null then
   update public.payment_refund_provider_events set processing_status='ignored',processing_outcome=case when error_code='refund_evidence_conflict' then 'conflict' else 'ignored' end,processing_error_code=error_code where receipt_event_id=p_event_id;
   update public.payment_provider_events set status='ignored',last_error_code=error_code where id=p_event_id;
   return query select case when error_code='refund_evidence_conflict' then 'conflict' else 'ignored' end::text,f.id; return;
 end if;
 evidence_status:=case when re.refund_status='succeeded' then 'succeeded' else 'failed' end;
 if a.id is null then
   is_external:=true;
   insert into public.payment_refund_attempts(refund_id,attempt_number,status,preparation_idempotency_key,prepared_source,prepared_actor,prepared_at)
   select f.id,coalesce(max(ra.attempt_number),0)+1,'prepared',p_event_id,'operator_tool','stripe_refund_webhook',now_at
   from public.payment_refund_attempts ra where ra.refund_id=f.id returning * into a;
   insert into public.payment_refund_history(refund_id,organisation_id,reservation_id,payment_attempt_id,action,previous_status,resulting_status,actor_source,actor_id,idempotency_key,occurred_at)
   values(f.id,f.organisation_id,f.reservation_id,f.payment_attempt_id,'replacement_prepared','failed','prepared','operator_tool','stripe_refund_webhook',p_event_id,now_at);
 end if;
 -- Lock provider receipt rows only after reservation -> payment -> obligation -> attempt.
 select * into pe from public.payment_provider_events where id=p_event_id for update;
 select * into re from public.payment_refund_provider_events where receipt_event_id=p_event_id for update;
 if pe.status<>'received' or re.processing_status<>'received' then raise exception 'refund event changed during reconciliation' using errcode='40001'; end if;
 select * into result from public.record_payment_refund_attempt_evidence(a.id,f.organisation_id,re.provider_refund_id,
   evidence_status,case when is_external then 'stripe_dashboard_reconciliation' else 'stripe_api' end,
   'operator_tool','stripe_refund_webhook',a.id);
 evidence_result:=result.outcome;
 if evidence_result not in (evidence_status,'already_recorded') then raise exception 'refund evidence authority returned invalid outcome' using errcode='P0001'; end if;
 update public.payment_refund_provider_events set processing_status='processed',processing_outcome=evidence_status,
   processing_error_code=null,matched_payment_refund_id=f.id,processed_at=now_at where receipt_event_id=p_event_id;
 update public.payment_provider_events set status='processed',processed_at=now_at,recovery_terminal_at=now_at,
   recovery_error_class=null where id=p_event_id and status='received';
 if not found then raise exception 'refund provider event changed during processing' using errcode='40001'; end if;
 return query select case when evidence_result='already_recorded' then 'already_processed' else evidence_status end::text,f.id;
end $$;

revoke all on function public.apply_payment_refund_provider_event(uuid) from public,anon,authenticated;
grant execute on function public.apply_payment_refund_provider_event(uuid) to service_role;

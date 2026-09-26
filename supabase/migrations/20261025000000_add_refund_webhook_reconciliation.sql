-- P3E4C3: retain only normalized refund webhook facts beside the shared receipt.
-- This is refund-specific reconciliation data, not a copy of Stripe payloads.

create table public.payment_refund_provider_events (
    receipt_event_id uuid primary key references public.payment_provider_events(id),
    provider_refund_id text not null,
    payment_intent_id text,
    amount_cents bigint not null,
    currency text not null,
    refund_status text not null,
    provider_created_at timestamptz not null,
    processing_status text not null default 'received',
    processing_outcome text,
    processing_error_code text,
    matched_payment_refund_id uuid references public.payment_refunds(id),
    processed_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),

    constraint payment_refund_provider_events_refund_id_check
        check (provider_refund_id ~ '^re_[A-Za-z0-9]+$'),
    constraint payment_refund_provider_events_intent_id_check
        check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
    constraint payment_refund_provider_events_amount_check
        check (amount_cents between 1 and 9999999999),
    constraint payment_refund_provider_events_currency_check check (currency = 'eur'),
    constraint payment_refund_provider_events_status_check
        check (refund_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
    constraint payment_refund_provider_events_processing_check check (
        (processing_status = 'received' and processed_at is null and processing_outcome is null)
        or (processing_status = 'processed' and processed_at is not null
            and processing_outcome in ('succeeded', 'failed', 'already_processed'))
        or (processing_status = 'ignored' and processed_at is null
            and processing_outcome in ('pending', 'ignored', 'conflict'))
    ),
    constraint payment_refund_provider_events_error_check
        check (processing_error_code is null or processing_error_code in (
            'malformed_refund_event', 'refund_livemode_mismatch', 'refund_unknown',
            'refund_ambiguous', 'refund_amount_mismatch', 'refund_currency_mismatch',
            'refund_payment_intent_mismatch', 'refund_evidence_conflict', 'refund_not_eligible'
        ))
);

create index payment_refund_provider_events_recovery_idx
    on public.payment_refund_provider_events (provider_created_at, receipt_event_id)
    where processing_status = 'received';

alter table public.payment_refund_provider_events enable row level security;
revoke all on table public.payment_refund_provider_events from public, anon, authenticated, service_role;

create function public.receive_payment_refund_provider_event(
    p_provider_event_id text,
    p_event_type text,
    p_provider_event_created_at timestamptz,
    p_livemode boolean,
    p_payload_sha256 text,
    p_expected_livemode boolean,
    p_provider_refund_id text,
    p_payment_intent_id text,
    p_amount_cents bigint,
    p_currency text,
    p_refund_status text,
    p_validation_error text
)
returns table (outcome text, event_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
    v_receipt record;
    v_event public.payment_provider_events%rowtype;
    v_existing public.payment_refund_provider_events%rowtype;
    v_has_normalized boolean;
begin
    if p_expected_livemode is null
       or p_event_type not in ('refund.created', 'refund.updated', 'refund.failed')
       or p_validation_error is not null and p_validation_error <> 'malformed_refund_event' then
        raise exception 'invalid refund provider-event receipt' using errcode = '22023';
    end if;

    if p_validation_error is null then
        if p_provider_refund_id is null or p_provider_refund_id !~ '^re_[A-Za-z0-9]+$'
           or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$')
           or p_amount_cents is null or p_amount_cents not between 1 and 9999999999
           or p_currency is distinct from 'eur'
           or p_refund_status is null
           or p_refund_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')
           or (p_event_type = 'refund.failed' and p_refund_status <> 'failed') then
            raise exception 'invalid normalized refund provider event' using errcode = '22023';
        end if;
    elsif p_provider_refund_id is not null or p_payment_intent_id is not null
       or p_amount_cents is not null or p_currency is not null or p_refund_status is not null then
        raise exception 'invalid malformed refund receipt fields' using errcode = '22023';
    end if;

    select r.outcome, r.event_id into v_receipt
    from public.receive_payment_provider_event(
        'stripe', p_provider_event_id, p_event_type, p_provider_event_created_at,
        p_livemode, p_payload_sha256
    ) r;

    select pe.* into v_event from public.payment_provider_events pe
    where pe.id = v_receipt.event_id for update;
    if not found then raise exception 'refund provider-event receipt unavailable' using errcode = 'P0001'; end if;

    if v_receipt.outcome = 'conflict' then
        return query select 'conflict'::text, v_event.id;
        return;
    end if;

    select re.* into v_existing from public.payment_refund_provider_events re
    where re.receipt_event_id = v_event.id for update;
    v_has_normalized := found;
    if v_has_normalized then
        if p_validation_error is null
           and v_existing.provider_refund_id = p_provider_refund_id
           and v_existing.payment_intent_id is not distinct from p_payment_intent_id
           and v_existing.amount_cents = p_amount_cents
           and v_existing.currency = p_currency
           and v_existing.refund_status = p_refund_status
           and v_existing.provider_created_at = p_provider_event_created_at then
            return query select case when v_existing.processing_status = 'ignored'
                                     then 'ignored' else 'duplicate' end::text, v_event.id;
            return;
        end if;
        if p_validation_error is not null and v_event.status = 'ignored' then
            return query select 'ignored'::text, v_event.id;
            return;
        end if;
        return query select 'conflict'::text, v_event.id;
        return;
    end if;

    if v_event.status <> 'received' or v_event.conflict_detected_at is not null then
        return query select 'ignored'::text, v_event.id;
        return;
    end if;

    if p_livemode is distinct from p_expected_livemode then
        update public.payment_provider_events pe
        set status = 'ignored', last_error_code = 'refund_livemode_mismatch'
        where pe.id = v_event.id;
        return query select 'ignored'::text, v_event.id;
        return;
    end if;

    if p_validation_error is not null then
        update public.payment_provider_events pe
        set status = 'ignored', last_error_code = 'malformed_refund_event'
        where pe.id = v_event.id;
        return query select 'ignored'::text, v_event.id;
        return;
    end if;

    insert into public.payment_refund_provider_events (
        receipt_event_id, provider_refund_id, payment_intent_id, amount_cents,
        currency, refund_status, provider_created_at
    ) values (
        v_event.id, p_provider_refund_id, p_payment_intent_id, p_amount_cents,
        p_currency, p_refund_status, p_provider_event_created_at
    );
    return query select 'recorded'::text, v_event.id;
end;
$$;

create function public.apply_payment_refund_provider_event(p_event_id uuid)
returns table (outcome text, refund_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
    v_event public.payment_provider_events%rowtype;
    v_refund_event public.payment_refund_provider_events%rowtype;
    v_refund public.payment_refunds%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_exception public.payment_exceptions%rowtype;
    v_refund_id uuid;
    v_evidence_outcome text;
    v_evidence_result text;
    v_error_code text;
    v_now timestamptz := clock_timestamp();
begin
    if p_event_id is null then raise exception 'refund event unavailable' using errcode = 'P0002'; end if;
    select pe.* into v_event from public.payment_provider_events pe
    where pe.id = p_event_id and pe.provider = 'stripe'
      and pe.event_type in ('refund.created', 'refund.updated', 'refund.failed')
    for update;
    if not found then raise exception 'refund event unavailable' using errcode = 'P0002'; end if;

    select re.* into v_refund_event from public.payment_refund_provider_events re
    where re.receipt_event_id = p_event_id for update;
    if not found then raise exception 'normalized refund event unavailable' using errcode = 'P0002'; end if;
    if v_refund_event.processing_status = 'processed' then
        return query select 'already_processed'::text, v_refund_event.matched_payment_refund_id;
        return;
    elsif v_refund_event.processing_status = 'ignored' or v_event.status = 'ignored'
       or v_event.conflict_detected_at is not null then
        return query select coalesce(v_refund_event.processing_outcome, 'ignored')::text,
                            v_refund_event.matched_payment_refund_id;
        return;
    elsif v_event.status <> 'received' or v_refund_event.processing_status <> 'received'
       or v_event.livemode is null or v_event.payload_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'refund event receipt is inconsistent' using errcode = 'P0001';
    end if;

    if v_refund_event.refund_status in ('pending', 'requires_action') then
        update public.payment_refund_provider_events re
        set processing_status = 'ignored', processing_outcome = 'pending'
        where re.receipt_event_id = p_event_id;
        update public.payment_provider_events pe
        set status = 'ignored', last_error_code = 'refund_not_eligible'
        where pe.id = p_event_id;
        return query select 'pending'::text, null::uuid;
        return;
    end if;

    select pr.id into v_refund_id
    from public.payment_refunds pr
    where pr.provider = 'stripe' and pr.provider_refund_id = v_refund_event.provider_refund_id;

    if not found and v_refund_event.payment_intent_id is not null then
        select pr.id into v_refund_id
        from public.payment_refunds pr
        join public.payment_attempts pa
          on pa.id = pr.payment_attempt_id
         and pa.reservation_id = pr.reservation_id
         and pa.organisation_id = pr.organisation_id
        where pr.provider = 'stripe' and pr.status = 'prepared'
          and pr.provider_refund_id is null
          and pa.provider = 'stripe'
          and pa.provider_payment_intent_id = v_refund_event.payment_intent_id;
    end if;

    if not found or v_refund_id is null then
        v_error_code := 'refund_unknown';
    else
        select pr.* into v_refund from public.payment_refunds pr
        where pr.id = v_refund_id for update;
        select pa.* into v_attempt from public.payment_attempts pa
        where pa.id = v_refund.payment_attempt_id
          and pa.reservation_id = v_refund.reservation_id
          and pa.organisation_id = v_refund.organisation_id;
        select e.* into v_exception from public.payment_exceptions e
        where e.id = v_refund.payment_exception_id
          and e.organisation_id = v_refund.organisation_id
          and e.reservation_id = v_refund.reservation_id
          and e.payment_attempt_id = v_refund.payment_attempt_id;

        if not found or v_refund.provider <> 'stripe'
           or v_attempt.provider <> 'stripe'
           or v_exception.status <> 'resolved' or v_exception.resolution <> 'refund_required' then
            v_error_code := 'refund_not_eligible';
        elsif v_refund.amount * 100 <> v_refund_event.amount_cents then
            v_error_code := 'refund_amount_mismatch';
        elsif v_refund.currency <> 'EUR' or v_refund_event.currency <> 'eur' then
            v_error_code := 'refund_currency_mismatch';
        elsif v_refund_event.payment_intent_id is not null
           and v_attempt.provider_payment_intent_id <> v_refund_event.payment_intent_id then
            v_error_code := 'refund_payment_intent_mismatch';
        elsif v_refund.status = 'prepared' and v_refund.provider_refund_id is not null then
            v_error_code := 'refund_not_eligible';
        elsif v_refund.status not in ('prepared', 'succeeded', 'failed')
           or v_refund.status <> 'prepared'
              and v_refund.provider_refund_id <> v_refund_event.provider_refund_id then
            v_error_code := 'refund_not_eligible';
        else
            v_error_code := null;
        end if;
    end if;

    if v_error_code is not null then
        update public.payment_refund_provider_events re
        set processing_status = 'ignored', processing_outcome = 'ignored',
            processing_error_code = v_error_code
        where re.receipt_event_id = p_event_id;
        update public.payment_provider_events pe
        set status = 'ignored', last_error_code = v_error_code
        where pe.id = p_event_id;
        return query select 'ignored'::text, v_refund_id;
        return;
    end if;

    v_evidence_outcome := case when v_refund_event.refund_status = 'succeeded'
                               then 'succeeded' else 'failed' end;
    begin
        select result.outcome into v_evidence_result
        from public.record_payment_refund_evidence(
            v_refund.id, v_refund.organisation_id, v_refund_event.provider_refund_id,
            v_evidence_outcome, 'stripe_api', 'operator_tool', 'stripe_refund_executor', v_refund.id
        ) result;
    exception when sqlstate 'P0001' or sqlstate 'P0002' then
        update public.payment_refund_provider_events re
        set processing_status = 'ignored', processing_outcome = 'conflict',
            processing_error_code = 'refund_evidence_conflict'
        where re.receipt_event_id = p_event_id;
        update public.payment_provider_events pe
        set status = 'ignored', last_error_code = 'refund_evidence_conflict'
        where pe.id = p_event_id;
        return query select 'conflict'::text, v_refund.id;
        return;
    end;

    if v_evidence_result not in (v_evidence_outcome, 'already_recorded') then
        raise exception 'refund evidence authority returned an invalid result' using errcode = 'P0001';
    end if;

    update public.payment_refund_provider_events re
    set processing_status = 'processed', processing_outcome = v_evidence_outcome,
        processing_error_code = null, matched_payment_refund_id = v_refund.id,
        processed_at = v_now
    where re.receipt_event_id = p_event_id;
    update public.payment_provider_events pe
    set status = 'processed', processed_at = v_now, recovery_terminal_at = v_now,
        recovery_error_class = null
    where pe.id = p_event_id and pe.status = 'received';
    if not found then raise exception 'refund provider event changed during processing' using errcode = '40001'; end if;
    return query select case when v_evidence_result = 'already_recorded'
                             then 'already_processed' else v_evidence_outcome end::text, v_refund.id;
end;
$$;

create function public.claim_payment_refund_event_recovery(
    p_limit integer,
    p_expected_livemode boolean
)
returns table (event_id uuid, claim_token uuid, attempt_count integer)
language plpgsql security definer set search_path = '' as $$
declare
    v_now timestamptz := clock_timestamp();
begin
    if p_limit is null or p_limit < 1 or p_limit > 20 or p_expected_livemode is null then
        raise exception 'refund recovery claim requires limit 1..20 and expected livemode'
            using errcode = '22023';
    end if;

    with exhausted as (
        select pe.id
        from public.payment_provider_events pe
        join public.payment_refund_provider_events re on re.receipt_event_id = pe.id
        where pe.provider = 'stripe' and pe.event_type in ('refund.created', 'refund.updated', 'refund.failed')
          and pe.status = 'received' and pe.conflict_detected_at is null
          and pe.livemode = p_expected_livemode and re.processing_status = 'received'
          and pe.recovery_terminal_at is null and pe.recovery_attempt_count >= 8
          and pe.recovery_next_attempt_at <= v_now
          and (pe.recovery_lease_until is null or pe.recovery_lease_until <= v_now)
        order by pe.recovery_lease_until nulls first, pe.recovery_last_attempt_at, pe.created_at, pe.id
        for update of pe skip locked limit p_limit
    )
    update public.payment_provider_events pe
    set status = 'ignored', last_error_code = 'recovery_exhausted',
        recovery_error_class = 'retry_exhausted', recovery_terminal_at = v_now,
        recovery_lease_until = null, recovery_claim_token = null
    from exhausted x where pe.id = x.id;

    update public.payment_refund_provider_events re
    set processing_status = 'ignored', processing_outcome = 'ignored',
        processing_error_code = 'refund_not_eligible'
    from public.payment_provider_events pe
    where re.receipt_event_id = pe.id and pe.last_error_code = 'recovery_exhausted'
      and re.processing_status = 'received' and pe.status = 'ignored';

    return query
    with candidates as (
        select pe.id from public.payment_provider_events pe
        join public.payment_refund_provider_events re on re.receipt_event_id = pe.id
        where pe.provider = 'stripe' and pe.event_type in ('refund.created', 'refund.updated', 'refund.failed')
          and pe.status = 'received' and pe.conflict_detected_at is null
          and pe.livemode = p_expected_livemode and re.processing_status = 'received'
          and pe.recovery_terminal_at is null and pe.recovery_attempt_count < 8
          and pe.recovery_next_attempt_at <= v_now
          and (pe.recovery_lease_until is null or pe.recovery_lease_until <= v_now)
        order by pe.recovery_next_attempt_at, pe.created_at, pe.id
        for update of pe skip locked limit p_limit
    ), claimed as (
        update public.payment_provider_events pe
        set recovery_attempt_count = pe.recovery_attempt_count + 1,
            recovery_last_attempt_at = v_now,
            recovery_lease_until = v_now + interval '5 minutes',
            recovery_claim_token = pg_catalog.gen_random_uuid()
        from candidates c where pe.id = c.id
        returning pe.id, pe.recovery_claim_token, pe.recovery_attempt_count,
            pe.recovery_next_attempt_at, pe.created_at
    )
    select c.id, c.recovery_claim_token, c.recovery_attempt_count
    from claimed c order by c.recovery_next_attempt_at, c.created_at, c.id;
end;
$$;

revoke all on function public.receive_payment_refund_provider_event(text, text, timestamptz, boolean, text, boolean, text, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.receive_payment_refund_provider_event(text, text, timestamptz, boolean, text, boolean, text, text, bigint, text, text, text) to service_role;
revoke all on function public.apply_payment_refund_provider_event(uuid) from public, anon, authenticated;
grant execute on function public.apply_payment_refund_provider_event(uuid) to service_role;
revoke all on function public.claim_payment_refund_event_recovery(integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_payment_refund_event_recovery(integer, boolean) to service_role;

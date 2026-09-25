-- P3E3A: derive the paid/review transition only from a durably matched
-- provider event and current database relationships. This function does not
-- verify a provider signature; matched_at is the durable P3D3 proof marker.

create function public.apply_provider_payment_outcome(p_event_id uuid)
returns table (
    outcome text,
    reservation_id uuid,
    payment_attempt_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_initial_event public.payment_provider_events%rowtype;
    v_event public.payment_provider_events%rowtype;
    v_initial_attempt public.payment_attempts%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_reservation public.reservations%rowtype;
    v_now timestamptz;
    v_hold_expiry timestamptz;
    v_item_count integer := 0;
    v_current_count integer := 0;
    v_linked_count integer := 0;
    v_distinct_item_count integer := 0;
    v_distinct_machine_count integer := 0;
    v_reference_start timestamptz;
    v_reference_end timestamptz;
    v_job_count integer := 0;
    v_delivery_count integer := 0;
    v_collection_count integer := 0;
    v_business_valid boolean := true;
begin
    if p_event_id is null then
        return query select 'not_authoritative', null::uuid, null::uuid;
        return;
    end if;

    -- Read only enough to discover the reservation. The authoritative locks
    -- are acquired below in reservation -> items -> allocations -> jobs ->
    -- attempt -> provider-event order, then all evidence is re-read.
    select pe.* into v_initial_event
    from public.payment_provider_events as pe
    where pe.id = p_event_id;

    if not found
       or v_initial_event.provider <> 'stripe'
       or v_initial_event.event_type <> 'checkout.session.completed'
       or v_initial_event.status not in ('received', 'processed')
       or v_initial_event.organisation_id is null
       or v_initial_event.payment_attempt_id is null
       or v_initial_event.matched_at is null
       or v_initial_event.conflict_detected_at is not null
       or v_initial_event.payload_sha256 is null
       or v_initial_event.payload_sha256 !~ '^[0-9a-f]{64}$'
       or v_initial_event.livemode is null then
        return query select 'not_authoritative', null::uuid, null::uuid;
        return;
    end if;

    select pa.* into v_initial_attempt
    from public.payment_attempts as pa
    where pa.id = v_initial_event.payment_attempt_id
      and pa.organisation_id = v_initial_event.organisation_id;

    if not found then
        return query select 'not_authoritative', null::uuid, null::uuid;
        return;
    end if;

    select r.* into v_reservation
    from public.reservations as r
    where r.id = v_initial_attempt.reservation_id
      and r.organisation_id = v_initial_attempt.organisation_id
    for update;

    if not found then
        return query select 'not_authoritative', null::uuid,
                            v_initial_attempt.id;
        return;
    end if;

    perform 1
    from public.reservation_items as ri
    where ri.reservation_id = v_reservation.id
    order by ri.product_id, ri.id
    for update;

    perform 1
    from public.allocations as a
    where a.reservation_id = v_reservation.id
    order by a.id
    for update;

    perform 1
    from public.service_jobs as sj
    where sj.reservation_id = v_reservation.id
    order by sj.id
    for update;

    select pa.* into v_attempt
    from public.payment_attempts as pa
    where pa.id = v_initial_attempt.id
      and pa.organisation_id = v_initial_attempt.organisation_id
    for update;

    if not found then
        return query select 'not_authoritative', v_reservation.id,
                            v_initial_attempt.id;
        return;
    end if;

    select pe.* into v_event
    from public.payment_provider_events as pe
    where pe.id = p_event_id
    for update;

    if not found
       or v_event.provider <> 'stripe'
       or v_event.event_type <> 'checkout.session.completed'
       or v_event.status not in ('received', 'processed')
       or v_event.organisation_id <> v_attempt.organisation_id
       or v_event.payment_attempt_id <> v_attempt.id
       or v_event.matched_at is null
       or v_event.conflict_detected_at is not null
       or v_event.payload_sha256 is null
       or v_event.payload_sha256 !~ '^[0-9a-f]{64}$'
       or v_event.livemode is null
       or v_attempt.provider <> 'stripe'
       or v_attempt.purpose <> 'rental'
       or v_attempt.reservation_id <> v_reservation.id
       or v_attempt.organisation_id <> v_reservation.organisation_id
       or v_attempt.currency <> 'EUR'
       or v_attempt.amount <> v_reservation.total_amount
       or v_attempt.provider_checkout_session_id is null
       or v_attempt.provider_payment_intent_id is null then
        return query select 'not_authoritative', v_reservation.id,
                            v_attempt.id;
        return;
    end if;

    v_now := clock_timestamp();

    -- A durable replay never re-confirms, mutates inventory, or downgrades a
    -- final result. A second valid event for the same attempt is also idempotent.
    if v_attempt.status in ('paid', 'requires_review') then
        if v_attempt.paid_at is null
           or v_reservation.payment_status is distinct from v_attempt.status
           or (v_attempt.status = 'paid'
               and v_reservation.status not in ('confirmed', 'ongoing', 'completed', 'cancelled')) then
            raise exception 'Payment final state is inconsistent with reservation'
                using errcode = 'P0001';
        end if;

        if v_event.status = 'received' then
            update public.payment_provider_events as pe
            set status = 'processed', processed_at = v_now
            where pe.id = p_event_id and pe.status = 'received';
            if not found then
                raise exception 'Provider event changed during outcome transition'
                    using errcode = '40001';
            end if;
        end if;

        return query select case when v_attempt.status = 'paid'
                                 then 'already_paid' else 'already_requires_review' end,
                            v_reservation.id, v_attempt.id;
        return;
    end if;

    if v_attempt.status not in ('created', 'checkout_open') then
        return query select 'not_authoritative', v_reservation.id,
                            v_attempt.id;
        return;
    end if;

    if v_event.status = 'processed' then
        -- A processed event without its matching durable final attempt state
        -- is inconsistent historical data; never infer or repair authority.
        return query select 'not_authoritative', v_reservation.id,
                            v_attempt.id;
        return;
    end if;

    -- Final payment states owned by another attempt or a prior refund are not
    -- overwritten. They require separate reconciliation, not this transition.
    if v_reservation.payment_status not in ('not_started', 'processing') then
        return query select 'not_authoritative', v_reservation.id,
                            v_attempt.id;
        return;
    end if;

    select count(*)::integer,
           count(*) filter (where sj.job_type = 'delivery')::integer,
           count(*) filter (where sj.job_type = 'collection')::integer
    into v_job_count, v_delivery_count, v_collection_count
    from public.service_jobs as sj
    where sj.reservation_id = v_reservation.id;

    if v_reservation.status in ('confirmed', 'ongoing', 'completed') then
        -- These lifecycle states have already passed confirmation. Validate
        -- the durable basket, but do not repeat confirmation or its outbox.
        v_business_valid := v_job_count = 2
            and v_delivery_count = 1 and v_collection_count = 1
            and not exists (
                select 1 from public.service_jobs as sj
                where sj.reservation_id = v_reservation.id
                  and sj.status not in ('scheduled', 'assigned', 'in_progress', 'completed')
            );

        select count(*)::integer into v_item_count
        from public.reservation_items as ri
        where ri.reservation_id = v_reservation.id;

        if v_item_count > 0 then
            select a.operational_start, a.operational_end
            into v_reference_start, v_reference_end
            from public.allocations as a
            where a.reservation_id = v_reservation.id
              and a.status in ('held', 'reserved', 'active')
            order by a.id
            limit 1;

            select count(*)::integer,
                   count(*) filter (where a.reservation_item_id is not null)::integer,
                   count(distinct a.reservation_item_id)::integer,
                   count(distinct a.machine_id)::integer
            into v_current_count, v_linked_count,
                 v_distinct_item_count, v_distinct_machine_count
            from public.allocations as a
            where a.reservation_id = v_reservation.id
              and a.status in ('held', 'reserved', 'active');

            v_business_valid := v_business_valid
                and v_current_count = v_item_count
                and v_linked_count = v_item_count
                and v_distinct_item_count = v_item_count
                and v_distinct_machine_count = v_item_count
                and not exists (
                    select 1
                    from public.reservation_items as ri
                    left join public.allocations as a
                      on a.reservation_item_id = ri.id
                     and a.reservation_id = ri.reservation_id
                     and a.status in ('held', 'reserved', 'active')
                    left join public.physical_machines as pm on pm.id = a.machine_id
                    where ri.reservation_id = v_reservation.id
                    group by ri.id, ri.product_id
                    having count(a.id) <> 1
                        or bool_or(a.status <> 'reserved')
                        or bool_or(a.hold_expires_at is not null)
                        or bool_or(pm.product_id is distinct from ri.product_id)
                        or bool_or(a.operational_start is distinct from v_reference_start)
                        or bool_or(a.operational_end is distinct from v_reference_end)
                )
                and not exists (
                    select 1 from public.allocations as a
                    where a.reservation_id = v_reservation.id
                      and a.status in ('held', 'reserved', 'active')
                      and (a.reservation_item_id is null or a.status <> 'reserved'
                           or a.hold_expires_at is not null)
                );
        else
            select count(*)::integer into v_current_count
            from public.allocations as a
            where a.reservation_id = v_reservation.id
              and a.status in ('held', 'reserved', 'active');
            v_business_valid := v_business_valid and v_current_count > 0
                and not exists (
                    select 1 from public.allocations as a
                    where a.reservation_id = v_reservation.id
                      and a.status in ('held', 'reserved', 'active')
                      and (a.status <> 'reserved' or a.hold_expires_at is not null)
                );
        end if;

        if v_business_valid then
            update public.payment_attempts as pa
            set status = 'paid', paid_at = v_now, updated_at = v_now
            where pa.id = v_attempt.id and pa.status in ('created', 'checkout_open');
            if not found then
                raise exception 'Payment attempt changed during outcome transition'
                    using errcode = '40001';
            end if;
            update public.reservations as r
            set payment_status = 'paid', updated_at = v_now
            where r.id = v_reservation.id
              and r.payment_status in ('not_started', 'processing');
            if not found then
                raise exception 'Reservation payment state changed during outcome transition'
                    using errcode = '40001';
            end if;
            update public.payment_provider_events as pe
            set status = 'processed', processed_at = v_now
            where pe.id = p_event_id and pe.status = 'received';
            if not found then
                raise exception 'Provider event changed during outcome transition'
                    using errcode = '40001';
            end if;
            return query select 'paid_already_confirmed', v_reservation.id, v_attempt.id;
            return;
        end if;
    elsif v_reservation.status = 'pending' then
        -- A pending reservation needs exactly the original operational job
        -- pair, still scheduled. service_jobs is reservation-scoped and has no
        -- organisation_id column to cross-check independently.
        v_business_valid := v_job_count = 2
            and v_delivery_count = 1 and v_collection_count = 1
            and not exists (
                select 1 from public.service_jobs as sj
                where sj.reservation_id = v_reservation.id
                  and sj.status <> 'scheduled'
            );

        select count(*)::integer into v_item_count
        from public.reservation_items as ri
        where ri.reservation_id = v_reservation.id;

        if v_business_valid and v_item_count > 0 then
            begin
                select nb.hold_expires_at into v_hold_expiry
                from public.validate_normalized_basket(
                    v_reservation.id, v_reservation.organisation_id,
                    v_now, interval '0 seconds'
                ) as nb;
                -- The shared helper admits equality at a zero-minute boundary;
                -- paid confirmation deliberately requires strictly future expiry.
                v_business_valid := v_hold_expiry > v_now;
            exception when sqlstate 'P0001' then
                v_business_valid := false;
            end;
        elsif v_business_valid then
            -- Preserve the legacy confirm_reservation contract: one or more
            -- held allocations, and every held allocation has a future expiry.
            v_business_valid := exists (
                select 1 from public.allocations as a
                where a.reservation_id = v_reservation.id and a.status = 'held'
            ) and not exists (
                select 1 from public.allocations as a
                where a.reservation_id = v_reservation.id
                  and a.status = 'held'
                  and (a.hold_expires_at is null or a.hold_expires_at <= v_now)
            );
        end if;

        if v_business_valid then
            -- Reuse the established confirmation authority. Catch only its
            -- intentional lifecycle rejection; every other SQL error bubbles
            -- and rolls the entire transaction back.
            begin
                perform * from public.confirm_reservation(v_reservation.id);
            exception when sqlstate 'P0001' then
                v_business_valid := false;
            end;
        end if;
    else
        -- Cancelled or otherwise incompatible lifecycle state: provider proof
        -- is retained, but no inventory, reservation lifecycle, or jobs change.
        v_business_valid := false;
    end if;

    if v_business_valid then
        update public.payment_attempts as pa
        set status = 'paid', paid_at = v_now, updated_at = v_now
        where pa.id = v_attempt.id and pa.status in ('created', 'checkout_open');
        if not found then
            raise exception 'Payment attempt changed during outcome transition'
                using errcode = '40001';
        end if;
        update public.reservations as r
        set payment_status = 'paid', updated_at = v_now
        where r.id = v_reservation.id
          and r.payment_status in ('not_started', 'processing');
        if not found then
            raise exception 'Reservation payment state changed during outcome transition'
                using errcode = '40001';
        end if;
        update public.payment_provider_events as pe
        set status = 'processed', processed_at = v_now
        where pe.id = p_event_id and pe.status = 'received';
        if not found then
            raise exception 'Provider event changed during outcome transition'
                using errcode = '40001';
        end if;
        return query select 'paid_confirmed', v_reservation.id, v_attempt.id;
        return;
    end if;

    -- Provider proof is valid, but business state cannot be safely confirmed.
    -- No reservation status, allocation, job, or outbox mutation occurs here.
    update public.payment_attempts as pa
    set status = 'requires_review', paid_at = coalesce(pa.paid_at, v_now),
        updated_at = v_now
    where pa.id = v_attempt.id and pa.status in ('created', 'checkout_open');
    if not found then
        raise exception 'Payment attempt changed during review transition'
            using errcode = '40001';
    end if;
    update public.reservations as r
    set payment_status = 'requires_review', updated_at = v_now
    where r.id = v_reservation.id
      and r.payment_status in ('not_started', 'processing');
    if not found then
        raise exception 'Reservation payment state changed during review transition'
            using errcode = '40001';
    end if;
    update public.payment_provider_events as pe
    set status = 'processed', processed_at = v_now
    where pe.id = p_event_id and pe.status = 'received';
    if not found then
        raise exception 'Provider event changed during review transition'
            using errcode = '40001';
    end if;

    return query select 'requires_review', v_reservation.id, v_attempt.id;
end;
$$;

revoke all on function public.apply_provider_payment_outcome(uuid)
from public, anon, authenticated;
grant execute on function public.apply_provider_payment_outcome(uuid)
to service_role;

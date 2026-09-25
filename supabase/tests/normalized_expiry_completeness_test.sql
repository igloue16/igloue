begin;

select plan(45);

select ok(has_function_privilege('service_role', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'service_role can expire holds');
select ok(has_function_privilege('service_role', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'service_role can run cleanup');
select ok(not has_function_privilege('anon', 'public.expire_reservation_hold(uuid)', 'EXECUTE'), 'anon cannot expire holds');
select ok(not has_function_privilege('anon', 'public.cleanup_expired_reservation_holds(integer)', 'EXECUTE'), 'anon cannot run cleanup');
select ok((select prosecdef = false from pg_proc where oid = 'public.expire_reservation_hold(uuid)'::regprocedure), 'expiry remains SECURITY INVOKER');
select ok((select prosecdef = false from pg_proc where oid = 'public.cleanup_expired_reservation_holds(integer)'::regprocedure), 'cleanup remains SECURITY INVOKER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.expire_reservation_hold(uuid)'::regprocedure), 'expiry search_path remains hardened');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cleanup_expired_reservation_holds(integer)'::regprocedure), 'cleanup search_path remains hardened');

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3d2-product-a', 'MM3D2 Product A', 59, 250, true),
    ('mm3d2-product-b', 'MM3D2 Product B', 79, 350, true);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3d2-machine-a1', 'mm3d2-product-a', 'available', true),
    ('mm3d2-machine-a2', 'mm3d2-product-a', 'available', true),
    ('mm3d2-machine-b1', 'mm3d2-product-b', 'available', true),
    ('mm3d2-machine-b2', 'mm3d2-product-b', 'available', true);

create or replace function pg_temp.make_mm3d2_case(
    p_key text,
    p_products text[],
    p_machines text[]
)
returns uuid
language plpgsql
as $$
declare
    v_org uuid;
    v_customer uuid;
    v_reservation uuid;
    v_item uuid;
    v_start timestamptz := timestamptz '2055-01-01 12:00:00+00'
        + mod(abs(hashtext(p_key)::bigint), 1000) * interval '1 day';
    i integer;
begin
    select id into v_org from public.organisations where slug = 'igloue';
    insert into public.customers (organisation_id, first_name, last_name, email)
    values (v_org, 'MM3D2', p_key, p_key || '@mm3d2.test')
    returning id into v_customer;

    insert into public.reservations (
        organisation_id, customer_id, product_id, quantity,
        rental_start, rental_end, status,
        delivery_address_line_1, delivery_postcode, delivery_city,
        weekly_price_at_booking, deposit_amount, total_amount
    ) values (
        v_org, v_customer,
        case when coalesce(array_length(p_products, 1), 0) = 1 then p_products[1] else null end,
        greatest(1, coalesce(array_length(p_products, 1), 0)),
        v_start, v_start + interval '3 days', 'pending',
        'MM3D2 Street', '16000', 'Angouleme', 59, 0, 59
    ) returning id into v_reservation;

    for i in 1..coalesce(array_length(p_products, 1), 0) loop
        insert into public.reservation_items (
            organisation_id, reservation_id, product_id, unit_rental_price, line_total
        ) values (v_org, v_reservation, p_products[i], 59, 59)
        returning id into v_item;

        if i <= coalesce(array_length(p_machines, 1), 0) then
            insert into public.allocations (
                reservation_id, machine_id, reservation_item_id, status,
                operational_start, operational_end, hold_expires_at
            ) values (
                v_reservation, p_machines[i], v_item, 'held',
                v_start, v_start + interval '3 days', now() - interval '1 minute'
            );
        end if;
    end loop;

    if coalesce(array_length(p_products, 1), 0) = 0
       and coalesce(array_length(p_machines, 1), 0) > 0 then
        insert into public.allocations (
            reservation_id, machine_id, status,
            operational_start, operational_end, hold_expires_at
        ) values (
            v_reservation, p_machines[1], 'held',
            v_start, v_start + interval '3 days', now() - interval '1 minute'
        );
    end if;

    return v_reservation;
end;
$$;

select pg_temp.make_mm3d2_case('expired-single', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as expired_single \gset
insert into public.service_jobs (reservation_id, job_type, scheduled_date, address_line_1, postcode, city, status)
values
    (:'expired_single', 'delivery', date '2055-01-01', 'MM3D2 Street', '16000', 'Angouleme', 'completed'),
    (:'expired_single', 'collection', date '2055-01-04', 'MM3D2 Street', '16000', 'Angouleme', 'scheduled');
select lives_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'expired_single'), 'expired normalized single expires');
select is((select status from public.reservations where id = :'expired_single'), 'cancelled', 'expired single reservation is cancelled');
select is((select count(*)::integer from public.allocations where reservation_id = :'expired_single' and status = 'released'), 1, 'expired single allocation is released');
select is((select count(*)::integer from public.allocations where reservation_id = :'expired_single' and hold_expires_at is null), 1, 'expired single hold expiry clears');
select is((select count(*)::integer from public.service_jobs where reservation_id = :'expired_single' and status = 'cancelled'), 1, 'scheduled expiry job is cancelled');
select is((select count(*)::integer from public.service_jobs where reservation_id = :'expired_single' and status = 'completed'), 1, 'completed expiry history is preserved');

select pg_temp.make_mm3d2_case('expired-multi', array['mm3d2-product-a','mm3d2-product-b'], array['mm3d2-machine-a2','mm3d2-machine-b1']) as expired_multi \gset
select is(public.cleanup_expired_reservation_holds(100), 1, 'cleanup expires valid normalized multi basket');
select is((select status from public.reservations where id = :'expired_multi'), 'cancelled', 'expired multi reservation is cancelled');
select is((select count(*)::integer from public.allocations where reservation_id = :'expired_multi' and status = 'released'), 2, 'all expired multi allocations are released');
select is((select count(*)::integer from public.allocations where reservation_id = :'expired_multi' and hold_expires_at is null), 2, 'all expired multi hold expiries clear');

select pg_temp.make_mm3d2_case('future-single', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as future_single \gset
update public.allocations set hold_expires_at = now() + interval '1 hour' where reservation_id = :'future_single';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'future_single'), 'P0001', null, 'future normalized single rejects expiry');
select is((select status from public.reservations where id = :'future_single'), 'pending', 'future single remains pending');
select is((select status from public.allocations where reservation_id = :'future_single'), 'held', 'future single allocation remains held');
select is((select count(*)::integer from public.service_jobs where reservation_id = :'future_single'), 0, 'future single has no mutated jobs');

select pg_temp.make_mm3d2_case('future-multi', array['mm3d2-product-a','mm3d2-product-b'], array['mm3d2-machine-a2','mm3d2-machine-b2']) as future_multi \gset
update public.allocations set hold_expires_at = now() + interval '1 hour' where reservation_id = :'future_multi';
select is(public.cleanup_expired_reservation_holds(100), 0, 'cleanup skips future normalized basket');
select is((select status from public.reservations where id = :'future_multi'), 'pending', 'future multi remains pending');

select pg_temp.make_mm3d2_case('missing-allocation', array['mm3d2-product-a','mm3d2-product-b'], array['mm3d2-machine-a1']) as missing_allocation \gset
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'missing_allocation'), 'P0001', null, 'missing normalized allocation rejects');
select is((select status from public.reservations where id = :'missing_allocation'), 'pending', 'missing allocation leaves reservation unchanged');

select pg_temp.make_mm3d2_case('null-link', array['mm3d2-product-a'], array['mm3d2-machine-a2']) as null_link \gset
update public.allocations set reservation_item_id = null where reservation_id = :'null_link';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'null_link'), 'P0001', null, 'null-linked allocation rejects');
select is((select status from public.allocations where reservation_id = :'null_link'), 'held', 'null-link allocation remains held');

select pg_temp.make_mm3d2_case('extra-reserved', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as extra_reserved \gset
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
select :'extra_reserved', 'mm3d2-machine-b1', 'reserved', operational_start, operational_end, null
from public.allocations where reservation_id = :'extra_reserved';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'extra_reserved'), 'P0001', null, 'extra reserved allocation rejects');

select pg_temp.make_mm3d2_case('extra-active', array['mm3d2-product-a'], array['mm3d2-machine-a2']) as extra_active \gset
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
select :'extra_active', 'mm3d2-machine-b2', 'active', operational_start, operational_end, null
from public.allocations where reservation_id = :'extra_active';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'extra_active'), 'P0001', null, 'extra active allocation rejects');

select pg_temp.make_mm3d2_case('wrong-product', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as wrong_product \gset
update public.allocations set machine_id = 'mm3d2-machine-b1' where reservation_id = :'wrong_product';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'wrong_product'), 'P0001', null, 'wrong-product allocation rejects');

select pg_temp.make_mm3d2_case('different-expiry', array['mm3d2-product-a','mm3d2-product-b'], array['mm3d2-machine-a2','mm3d2-machine-b2']) as different_expiry \gset
update public.allocations set hold_expires_at = hold_expires_at - interval '1 second' where reservation_id = :'different_expiry' and machine_id = 'mm3d2-machine-b2';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'different_expiry'), 'P0001', null, 'different hold expiries reject');

select pg_temp.make_mm3d2_case('different-start', array['mm3d2-product-a','mm3d2-product-b'], array['mm3d2-machine-a1','mm3d2-machine-b1']) as different_start \gset
update public.allocations set operational_start = operational_start + interval '1 hour' where reservation_id = :'different_start' and machine_id = 'mm3d2-machine-b1';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'different_start'), 'P0001', null, 'different operational starts reject');

select pg_temp.make_mm3d2_case('no-current', array['mm3d2-product-a'], array['mm3d2-machine-a2']) as no_current \gset
update public.allocations set status = 'released', hold_expires_at = null, released_at = now() where reservation_id = :'no_current';
select throws_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'no_current'), 'P0001', null, 'no current allocation rejects');

select pg_temp.make_mm3d2_case('cleanup-malformed', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as cleanup_malformed \gset
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
select :'cleanup_malformed', 'mm3d2-machine-b2', 'active', operational_start, operational_end, null
from public.allocations where reservation_id = :'cleanup_malformed';
select pg_temp.make_mm3d2_case('cleanup-valid-after-malformed', array['mm3d2-product-b'], array['mm3d2-machine-b1']) as cleanup_valid_after_malformed \gset
select is(public.cleanup_expired_reservation_holds(100), 1, 'malformed candidate does not block valid cleanup');
select is((select status from public.reservations where id = :'cleanup_malformed'), 'pending', 'malformed cleanup candidate remains pending');
select is((select status from public.reservations where id = :'cleanup_valid_after_malformed'), 'cancelled', 'valid cleanup candidate is cancelled');

-- Isolate the batch-limit assertions from intentionally malformed candidates
-- created above; those candidates were already proven to remain pending.
update public.reservations set status = 'cancelled' where status = 'pending';

select pg_temp.make_mm3d2_case('limit-one-a', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as limit_one_a \gset
select pg_temp.make_mm3d2_case('limit-one-b', array['mm3d2-product-b'], array['mm3d2-machine-b2']) as limit_one_b \gset
select is(public.cleanup_expired_reservation_holds(1), 1, 'cleanup respects batch limit');
select is(public.cleanup_expired_reservation_holds(1), 1, 'cleanup processes next limited candidate');
select is(public.cleanup_expired_reservation_holds(1), 0, 'repeated cleanup is idempotent');

select pg_temp.make_mm3d2_case('legacy-expiry', array[]::text[], array['mm3d2-machine-a2']) as legacy_expiry \gset
select lives_ok(format('select * from public.expire_reservation_hold(%L::uuid)', :'legacy_expiry'), 'legacy expiry remains compatible');
select is((select status from public.reservations where id = :'legacy_expiry'), 'cancelled', 'legacy expiry cancels reservation');

select pg_temp.make_mm3d2_case('legacy-cleanup', array[]::text[], array['mm3d2-machine-b1']) as legacy_cleanup \gset
select is(public.cleanup_expired_reservation_holds(100), 1, 'legacy cleanup remains compatible');

select pg_temp.make_mm3d2_case('cancel-recovery', array['mm3d2-product-a'], array['mm3d2-machine-a1']) as cancel_recovery \gset
update public.allocations set reservation_item_id = null where reservation_id = :'cancel_recovery';
select lives_ok(format('select * from public.cancel_reservation(%L::uuid)', :'cancel_recovery'), 'manual cancellation remains recovery path');
select is((select status from public.reservations where id = :'cancel_recovery'), 'cancelled', 'manual cancellation cancels malformed reservation');

select * from finish();
rollback;

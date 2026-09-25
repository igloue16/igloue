begin;

select plan(42);

select ok(has_function_privilege('service_role', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'service_role can confirm');
select ok(not has_function_privilege('anon', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'anon cannot confirm');
select ok(not has_function_privilege('authenticated', 'public.confirm_reservation(uuid)', 'EXECUTE'), 'authenticated cannot confirm');

select ok((select prosecdef = false from pg_proc where oid = 'public.confirm_reservation(uuid)'::regprocedure), 'confirmation remains SECURITY INVOKER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.confirm_reservation(uuid)'::regprocedure), 'confirmation search_path remains hardened');

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3d-product-a', 'MM3D Product A', 59, 250, true),
    ('mm3d-product-b', 'MM3D Product B', 79, 350, true),
    ('mm3d-product-c', 'MM3D Product C', 89, 450, true);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3d-machine-a1', 'mm3d-product-a', 'available', true),
    ('mm3d-machine-a2', 'mm3d-product-a', 'available', true),
    ('mm3d-machine-b1', 'mm3d-product-b', 'available', true),
    ('mm3d-machine-b2', 'mm3d-product-b', 'available', true);

create or replace function pg_temp.make_mm3d_case(
    p_key text,
    p_products text[],
    p_machines text[],
    p_reservation_status text default 'pending'
)
returns uuid
language plpgsql
as $$
declare
    v_org uuid;
    v_customer uuid;
    v_reservation uuid;
    v_item uuid;
    v_start timestamptz := timestamptz '2050-01-01 12:00:00+00'
        + (abs(hashtext(p_key)) % 1000) * interval '1 day';
    i integer;
begin
    select id into v_org from public.organisations where slug = 'igloue';
    insert into public.customers (organisation_id, first_name, last_name, email)
    values (v_org, 'MM3D', p_key, p_key || '@mm3d.test')
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
        v_start, v_start + interval '3 days', p_reservation_status,
        'MM3D Street', '16000', 'Angouleme', 59, 0, 59
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
                v_start, v_start + interval '3 days', v_start + interval '30 minutes'
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
            v_start, v_start + interval '3 days', v_start + interval '30 minutes'
        );
    end if;

    return v_reservation;
end;
$$;

select pg_temp.make_mm3d_case('valid-single', array['mm3d-product-a'], array['mm3d-machine-a1']) as valid_single \gset
select * from public.confirm_reservation(:'valid_single'::uuid);
select is((select status from public.reservations where id = :'valid_single'), 'confirmed', 'normalized single confirms');
select is((select status from public.allocations where reservation_id = :'valid_single'), 'reserved', 'single allocation becomes reserved');
select is((select hold_expires_at from public.allocations where reservation_id = :'valid_single'), null::timestamptz, 'single hold expiry clears');
select is((select count(*)::integer from public.outbox_events where aggregate_id = :'valid_single' and event_type = 'reservation.confirmed'), 1, 'single emits one confirmation event');
select lives_ok(format('select * from public.confirm_reservation(%L::uuid)', :'valid_single'), 'confirmed normalized single replay is idempotent');

select pg_temp.make_mm3d_case('valid-multi', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a2','mm3d-machine-b1']) as valid_multi \gset
select * from public.confirm_reservation(:'valid_multi'::uuid);
select is((select status from public.reservations where id = :'valid_multi'), 'confirmed', 'normalized multi confirms');
select is((select count(*)::integer from public.allocations where reservation_id = :'valid_multi' and status = 'reserved'), 2, 'all multi allocations become reserved');
select is((select count(*)::integer from public.allocations where reservation_id = :'valid_multi' and hold_expires_at is null), 2, 'all multi expiries clear');
select is((select count(*)::integer from public.outbox_events where aggregate_id = :'valid_multi' and event_type = 'reservation.confirmed'), 1, 'multi emits one confirmation event');
select lives_ok(format('select * from public.confirm_reservation(%L::uuid)', :'valid_multi'), 'confirmed normalized multi replay is idempotent');
select * from public.confirm_reservation(:'valid_multi'::uuid);
select is((select count(*)::integer from public.outbox_events where aggregate_id = :'valid_multi' and event_type = 'reservation.confirmed'), 1, 'replay does not duplicate event');

select pg_temp.make_mm3d_case('one-of-two', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1']) as one_of_two \gset
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'one_of_two'), 'P0001', null, 'missing current allocation rejects');
select is((select status from public.reservations where id = :'one_of_two'), 'pending', 'missing allocation leaves reservation unchanged');
select is((select count(*)::integer from public.outbox_events where aggregate_id = :'one_of_two' and event_type = 'reservation.confirmed'), 0, 'rejected confirmation emits no outbox event');

select pg_temp.make_mm3d_case('null-link', array['mm3d-product-a'], array['mm3d-machine-a1']) as null_link \gset
update public.allocations set reservation_item_id = null where reservation_id = :'null_link';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'null_link'), 'P0001', null, 'null-linked current allocation rejects');
select is((select status from public.allocations where reservation_id = :'null_link'), 'held', 'null-link failure leaves allocation unchanged');

select pg_temp.make_mm3d_case('wrong-item-link', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1','mm3d-machine-b1']) as wrong_item_link \gset
update public.allocations
set reservation_item_id = null
where reservation_id = :'wrong_item_link' and machine_id = 'mm3d-machine-b1';
update public.allocations
set reservation_item_id = (
    select id from public.reservation_items
    where reservation_id = :'wrong_item_link' and product_id = 'mm3d-product-b'
)
where reservation_id = :'wrong_item_link' and machine_id = 'mm3d-machine-a1';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'wrong_item_link'), 'P0001', null, 'wrong reservation-item linkage rejects');

select pg_temp.make_mm3d_case('extra-current', array['mm3d-product-a'], array['mm3d-machine-a1']) as extra_current \gset
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at)
select :'extra_current', 'mm3d-machine-a2', 'held', operational_start, operational_end, hold_expires_at
from public.allocations where reservation_id = :'extra_current';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'extra_current'), 'P0001', null, 'extra current allocation rejects');
select is((select status from public.reservations where id = :'extra_current'), 'pending', 'extra allocation failure leaves reservation unchanged');

select pg_temp.make_mm3d_case('wrong-product', array['mm3d-product-a'], array['mm3d-machine-a1']) as wrong_product \gset
update public.allocations set machine_id = 'mm3d-machine-b2' where reservation_id = :'wrong_product';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'wrong_product'), 'P0001', null, 'wrong machine product rejects');

select pg_temp.make_mm3d_case('held-reserved', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1','mm3d-machine-b1']) as held_reserved \gset
update public.allocations set status = 'reserved' where reservation_id = :'held_reserved' and machine_id = 'mm3d-machine-b1';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'held_reserved'), 'P0001', null, 'held plus reserved rejects');

select pg_temp.make_mm3d_case('held-active', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a2','mm3d-machine-b2']) as held_active \gset
update public.allocations set status = 'active' where reservation_id = :'held_active' and machine_id = 'mm3d-machine-b2';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'held_active'), 'P0001', null, 'held plus active rejects');

select pg_temp.make_mm3d_case('reserved-reserved', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1','mm3d-machine-b1']) as reserved_reserved \gset
update public.allocations set status = 'reserved' where reservation_id = :'reserved_reserved';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'reserved_reserved'), 'P0001', null, 'reserved-only pending basket rejects');

select pg_temp.make_mm3d_case('held-released', array['mm3d-product-a'], array['mm3d-machine-a2']) as held_released \gset
insert into public.allocations (reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at, released_at)
select reservation_id, 'mm3d-machine-b2', 'released', operational_start, operational_end, null, now()
from public.allocations where reservation_id = :'held_released';
select lives_ok(format('select * from public.confirm_reservation(%L::uuid)', :'held_released'), 'historical released row does not invalidate current set');

select pg_temp.make_mm3d_case('no-current', array['mm3d-product-a'], array['mm3d-machine-a1']) as no_current \gset
update public.allocations set status = 'released', hold_expires_at = null, released_at = now() where reservation_id = :'no_current';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'no_current'), 'P0001', null, 'no current allocation rejects');

select pg_temp.make_mm3d_case('expired', array['mm3d-product-a'], array['mm3d-machine-a1']) as expired_case \gset
update public.allocations set hold_expires_at = now() - interval '1 second' where reservation_id = :'expired_case';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'expired_case'), 'P0001', null, 'expired hold rejects');

select pg_temp.make_mm3d_case('null-expiry', array['mm3d-product-a'], array['mm3d-machine-a2']) as null_expiry \gset
update public.allocations set hold_expires_at = null where reservation_id = :'null_expiry';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'null_expiry'), 'P0001', null, 'null expiry rejects');

select pg_temp.make_mm3d_case('different-expiry', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1','mm3d-machine-b1']) as different_expiry \gset
update public.allocations set hold_expires_at = hold_expires_at + interval '1 second' where reservation_id = :'different_expiry' and machine_id = 'mm3d-machine-b1';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'different_expiry'), 'P0001', null, 'different expiry rejects');

select pg_temp.make_mm3d_case('different-start', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a2','mm3d-machine-b2']) as different_start \gset
update public.allocations set operational_start = operational_start + interval '1 hour' where reservation_id = :'different_start' and machine_id = 'mm3d-machine-b2';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'different_start'), 'P0001', null, 'different operational start rejects');

select pg_temp.make_mm3d_case('different-end', array['mm3d-product-a','mm3d-product-b'], array['mm3d-machine-a1','mm3d-machine-b1']) as different_end \gset
update public.allocations set operational_end = operational_end + interval '1 hour' where reservation_id = :'different_end' and machine_id = 'mm3d-machine-b1';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'different_end'), 'P0001', null, 'different operational end rejects');

select ok(exists (select 1 from pg_constraint where conname = 'allocations_dates_valid'), 'allocation range constraint remains present');
select ok(exists (select 1 from pg_constraint where conname = 'allocations_no_machine_overlap'), 'machine overlap constraint prevents duplicate-machine current rows');
select ok(to_regclass('public.allocations_one_item_one_allocation_uidx') is not null, 'schema prevents duplicate current item representation');

select pg_temp.make_mm3d_case('confirmed-malformed', array['mm3d-product-a'], array['mm3d-machine-a1'], 'confirmed') as confirmed_malformed \gset
update public.allocations set status = 'held', hold_expires_at = now() + interval '1 hour' where reservation_id = :'confirmed_malformed';
select throws_ok(format('select * from public.confirm_reservation(%L::uuid)', :'confirmed_malformed'), 'P0001', null, 'malformed confirmed normalized reservation rejects');

select pg_temp.make_mm3d_case('legacy', array[]::text[], array['mm3d-machine-b2']) as legacy_case \gset
select lives_ok(format('select * from public.confirm_reservation(%L::uuid)', :'legacy_case'), 'legacy reservation confirms without reservation_items');
select is((select status from public.reservations where id = :'legacy_case'), 'confirmed', 'legacy reservation becomes confirmed');

select pg_temp.make_mm3d_case('legacy-null-link', array[]::text[], array['mm3d-machine-a1']) as legacy_null_link \gset
select lives_ok(format('select * from public.confirm_reservation(%L::uuid)', :'legacy_null_link'), 'legacy null-linked allocation remains confirmable');

select * from finish();
rollback;

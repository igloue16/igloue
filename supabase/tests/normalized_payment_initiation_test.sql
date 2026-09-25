begin;

select plan(33);

select ok(to_regprocedure('public.validate_normalized_payment_basket(uuid,uuid,timestamptz)') is not null,
          'normalized payment basket validator exists');
select ok(has_function_privilege('service_role', 'public.validate_normalized_payment_basket(uuid,uuid,timestamptz)', 'EXECUTE'),
          'service_role can validate normalized payment baskets');
select ok(not has_function_privilege('public', 'public.validate_normalized_payment_basket(uuid,uuid,timestamptz)', 'EXECUTE'),
          'PUBLIC cannot validate normalized payment baskets');
select ok((select prosecdef = false and exists (select 1 from unnest(proconfig) as c where c like 'search_path=%')
           from pg_proc where oid = 'public.validate_normalized_payment_basket(uuid,uuid,timestamptz)'::regprocedure),
          'validator is invoker-security with an empty search path');
select ok((select prosecdef = false and exists (select 1 from unnest(proconfig) as c where c like 'search_path=%')
           from pg_proc where oid = 'public.initiate_reservation_payment(uuid,text,text)'::regprocedure),
          'payment initiation remains invoker-security with an empty search path');

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3e1-product-a', 'MM3E1 Product A', 59.00, 250.00, true),
    ('mm3e1-product-b', 'MM3E1 Product B', 79.00, 350.00, true),
    ('mm3e1-product-c', 'MM3E1 Product C', 89.00, 450.00, true);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3e1-machine-a', 'mm3e1-product-a', 'available', true),
    ('mm3e1-machine-b', 'mm3e1-product-b', 'available', true),
    ('mm3e1-machine-c', 'mm3e1-product-c', 'available', true);

create temporary table mm3e1_two as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('a', 64),
    'MM3E1', 'Two', 'mm3e1-two@example.test', '0612345678', null,
    '2046-01-01 12:00:00+00', '2046-01-08 12:00:00+00',
    '1 MM3E1 Street', null, '16000', 'Angouleme', 'local',
    null, 29, 0, null, 167,
    '2046-01-01', '0830-1030', '2046-01-08', '1630-1830',
    'mm3e1-two-1', '2046-01-01 06:30:00', '2046-01-08 22:30:00',
    'Two', 'Recipient', '0612345678', 'personal', 'Two Recipient', null,
    'mm3e1-two@example.test', '1 MM3E1 Street', null, '16000', 'Angouleme', 'FR',
    null, null,
    '[{"product_id":"mm3e1-product-a","quantity":1},{"product_id":"mm3e1-product-b","quantity":1}]'::jsonb
);

select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3e1_two)), 2,
          'normalized reservation has two expected items');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3e1_two) and status = 'held'), 2,
          'normalized reservation has two held allocations');
select is((select deposit_amount from public.reservations where id = (select reservation_id from mm3e1_two)), null::numeric,
          'normalized multi-item deposit remains NULL');

create temporary table mm3e1_two_first as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e1_two),
    chr(92) || 'x' || repeat('a', 64), 'mm3e1-two-payment'
);
select ok((select reused = false from mm3e1_two_first), 'first normalized initiation is not reused');
select is((select amount from mm3e1_two_first), 167.00::numeric, 'normalized payment uses reservation total amount');
select is((select currency from mm3e1_two_first), 'EUR', 'normalized payment uses EUR');
select is((select attempt_status from mm3e1_two_first), 'created', 'normalized payment attempt starts created');
select ok((select hold_expires_at > now() + interval '9 minutes' from mm3e1_two_first), 'normalized shared hold expiry is returned');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_two)), 1,
          'normalized basket creates one reservation payment attempt');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_two) and purpose <> 'rental'), 0,
          'normalized basket creates no per-item payment attempts');

create temporary table mm3e1_two_replay as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e1_two),
    chr(92) || 'x' || repeat('a', 64), 'mm3e1-two-replay'
);
select is((select payment_attempt_id from mm3e1_two_replay), (select payment_attempt_id from mm3e1_two_first),
          'normalized initiation reuses the active reservation attempt');
select ok((select reused from mm3e1_two_replay), 'normalized replay is marked reused');

create temporary table mm3e1_three as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3E1', 'Three', 'mm3e1-three@example.test', '0612345678', null,
    '2046-02-01 12:00:00+00', '2046-02-08 12:00:00+00',
    '2 MM3E1 Street', null, '16000', 'Angouleme', 'local',
    null, 29, 0, null, 256,
    '2046-02-01', '0830-1030', '2046-02-08', '1630-1830',
    'mm3e1-three-1', '2046-02-01 06:30:00', '2046-02-08 22:30:00',
    'Three', 'Recipient', '0612345678', 'personal', 'Three Recipient', null,
    'mm3e1-three@example.test', '2 MM3E1 Street', null, '16000', 'Angouleme', 'FR',
    null, null,
    '[{"product_id":"mm3e1-product-a","quantity":1},{"product_id":"mm3e1-product-b","quantity":1},{"product_id":"mm3e1-product-c","quantity":1}]'::jsonb
);
create temporary table mm3e1_three_first as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e1_three),
    chr(92) || 'x' || repeat('b', 64), 'mm3e1-three-payment'
);
select is((select amount from mm3e1_three_first), 256.00::numeric, 'three-item payment uses the authoritative basket total');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3e1_three) and status = 'held'), 3,
          'three-item initiation leaves the complete held set intact');

-- Historical allocation rows do not invalidate the current normalized basket.
update public.allocations
set status = 'released'
where reservation_id = (select reservation_id from mm3e1_two)
  and status = 'held'
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_two) and status = 'held' order by id limit 1);
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3e1_two) and status = 'released'), 1,
          'historical released allocations remain historical');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e1_two)
  and status = 'released';

-- Use the three-item reservation for malformed-basket checks before its attempt is created.
delete from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_three);

update public.allocations
set status = 'cancelled'
where reservation_id = (select reservation_id from mm3e1_three)
  and reservation_item_id = (select id from public.reservation_items where reservation_id = (select reservation_id from mm3e1_three) order by id desc limit 1);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-missing')$$,
                 'P0001', null, 'missing current allocation is rejected');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_three)), 0,
          'missing-allocation rejection creates no attempt');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e1_three)
  and status = 'cancelled';

update public.allocations
set reservation_item_id = null
where reservation_id = (select reservation_id from mm3e1_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-null-link')$$,
                 'P0001', null, 'NULL-linked current allocation is rejected');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_three)), 0,
          'NULL-link rejection creates no attempt');
update public.allocations as a
set reservation_item_id = (
    select ri.id
    from public.reservation_items as ri
    join public.physical_machines as pm on pm.id = a.machine_id and pm.product_id = ri.product_id
    where ri.reservation_id = a.reservation_id
    limit 1
)
where a.reservation_id = (select reservation_id from mm3e1_three)
  and a.reservation_item_id is null;

update public.reservation_items as ri
set product_id = 'mm3e1-product-c'
where ri.id = (
    select a.reservation_item_id
    from public.allocations as a
    join public.physical_machines as pm on pm.id = a.machine_id
    where a.reservation_id = (select reservation_id from mm3e1_three)
      and pm.product_id = 'mm3e1-product-a'
    order by a.id
    limit 1
);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-wrong-product')$$,
                 'P0001', null, 'machine/product mismatch is rejected');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e1_three)), 0,
          'machine/product rejection creates no attempt');
update public.reservation_items as ri
set product_id = 'mm3e1-product-a'
where ri.id = (
    select a.reservation_item_id
    from public.allocations as a
    join public.physical_machines as pm on pm.id = a.machine_id
    where a.reservation_id = (select reservation_id from mm3e1_three)
      and pm.product_id = 'mm3e1-product-a'
    order by a.id
    limit 1
);

update public.allocations
set operational_end = operational_end + interval '1 hour'
where reservation_id = (select reservation_id from mm3e1_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-range')$$,
                 'P0001', null, 'incoherent operational range is rejected');
update public.allocations as a
set operational_end = (
    select a2.operational_end
    from public.allocations as a2
    where a2.reservation_id = a.reservation_id
      and a2.id <> a.id
    order by a2.id
    limit 1
)
where a.reservation_id = (select reservation_id from mm3e1_three)
  and a.id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);

update public.allocations
set hold_expires_at = hold_expires_at + interval '1 minute'
where reservation_id = (select reservation_id from mm3e1_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-expiry')$$,
                 'P0001', null, 'different hold expiry is rejected');
update public.allocations as a
set hold_expires_at = (select min(hold_expires_at) from public.allocations where reservation_id = a.reservation_id)
where a.reservation_id = (select reservation_id from mm3e1_three)
  and a.id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);

update public.allocations
set status = 'reserved'
where reservation_id = (select reservation_id from mm3e1_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e1_three) order by id limit 1);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-reserved')$$,
                 'P0001', null, 'non-held normalized allocation is rejected');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e1_three)
  and status = 'reserved';

update public.reservation_payment_capabilities
set revoked_at = now()
where reservation_id = (select reservation_id from mm3e1_three);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-revoked')$$,
                 'P0001', null, 'revoked capability is rejected');
update public.reservation_payment_capabilities
set revoked_at = null
where reservation_id = (select reservation_id from mm3e1_three);

update public.reservations
set payment_status = 'paid'
where id = (select reservation_id from mm3e1_three);
select throws_ok($$select * from public.initiate_reservation_payment((select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-paid')$$,
                 'P0001', null, 'paid normalized reservation is rejected');
update public.reservations
set payment_status = 'not_started'
where id = (select reservation_id from mm3e1_three);

create temporary table mm3e1_three_final as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e1_three), chr(92) || 'x' || repeat('b', 64), 'mm3e1-three-final'
);
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from mm3e1_three)), 0,
          'payment initiation emits no reservation outbox event');
select is((select eligible from public.get_reservation_payment_checkout(
              (select payment_attempt_id from mm3e1_three_final),
              (select id from public.organisations where slug = 'igloue'))), false,
          'existing Checkout eligibility remains false for a normalized multi-item attempt');

select * from finish();
rollback;

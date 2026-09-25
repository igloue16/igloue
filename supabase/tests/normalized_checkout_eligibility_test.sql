begin;

select plan(40);

select ok(to_regprocedure('public.validate_normalized_basket(uuid,uuid,timestamptz,interval)') is not null,
          'normalized Checkout basket validator exists');
select ok(has_function_privilege('service_role', 'public.validate_normalized_basket(uuid,uuid,timestamptz,interval)', 'EXECUTE'),
          'service_role can validate Checkout baskets');
select ok(not has_function_privilege('public', 'public.validate_normalized_basket(uuid,uuid,timestamptz,interval)', 'EXECUTE'),
          'PUBLIC cannot validate Checkout baskets');
select ok((select prosecdef = false and exists (select 1 from unnest(proconfig) as c where c like 'search_path=%')
           from pg_proc where oid = 'public.get_reservation_payment_checkout(uuid,uuid)'::regprocedure),
          'Checkout state uses invoker security and a hardened search path');
select ok((select prosecdef = false and exists (select 1 from unnest(proconfig) as c where c like 'search_path=%')
           from pg_proc where oid = 'public.persist_reservation_payment_checkout(uuid,uuid,text,text,text)'::regprocedure),
          'Checkout persistence uses invoker security and a hardened search path');

insert into public.products (id, name, weekly_price, deposit_amount, active)
values
    ('mm3e2-product-a', 'MM3E2 Product A', 59.00, 250.00, true),
    ('mm3e2-product-b', 'MM3E2 Product B', 79.00, 350.00, true),
    ('mm3e2-product-c', 'MM3E2 Product C', 89.00, 450.00, true);

insert into public.physical_machines (id, product_id, status, active)
values
    ('mm3e2-machine-a', 'mm3e2-product-a', 'available', true),
    ('mm3e2-machine-b', 'mm3e2-product-b', 'available', true),
    ('mm3e2-machine-c', 'mm3e2-product-c', 'available', true),
    ('mm3e2-machine-a-extra', 'mm3e2-product-a', 'available', true);

create temporary table mm3e2_two as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('a', 64),
    'MM3E2', 'Two', 'mm3e2-two@example.test', '0612345678', null,
    '2047-01-01 12:00:00+00', '2047-01-08 12:00:00+00',
    '1 MM3E2 Street', null, '16000', 'Angouleme', 'local',
    null, 29, 0, null, 167,
    '2047-01-01', '0830-1030', '2047-01-08', '1630-1830',
    'mm3e2-two-1', '2047-01-01 06:30:00', '2047-01-08 22:30:00',
    'Two', 'Recipient', '0612345678', 'personal', 'Two Recipient', null,
    'mm3e2-two@example.test', '1 MM3E2 Street', null, '16000', 'Angouleme', 'FR',
    null, null,
    '[{"product_id":"mm3e2-product-a","quantity":1},{"product_id":"mm3e2-product-b","quantity":1}]'::jsonb
);

select is((select count(*)::integer from public.reservation_items where reservation_id = (select reservation_id from mm3e2_two)), 2,
          'normalized Checkout fixture has two expected items');
select is((select count(*)::integer from public.allocations where reservation_id = (select reservation_id from mm3e2_two) and status = 'held'), 2,
          'normalized Checkout fixture has two current held allocations');

create temporary table mm3e2_two_attempt as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e2_two), chr(92) || 'x' || repeat('a', 64), 'mm3e2-two-payment'
);
create temporary table mm3e2_two_state as
select * from public.get_reservation_payment_checkout(
    (select payment_attempt_id from mm3e2_two_attempt),
    (select id from public.organisations where slug = 'igloue')
);
select ok((select eligible from mm3e2_two_state), 'normalized two-item Checkout eligibility succeeds');
select is((select amount from mm3e2_two_state), 167.00::numeric, 'Checkout amount is reservations.total_amount');
select is((select currency from mm3e2_two_state), 'EUR', 'Checkout currency is EUR');
select ok((select hold_expires_at >= now() + interval '11 minutes' from mm3e2_two_state), 'pre-Stripe hold window is at least eleven minutes');

insert into public.allocations (
    id, reservation_id, machine_id, status, operational_start, operational_end, hold_expires_at
) values (
    '00000000-0000-4000-8000-00000000e901',
    (select reservation_id from mm3e2_two), 'mm3e2-machine-a', 'released',
    '2047-01-01 05:30:00+00', '2047-01-08 21:30:00+00', null
);
select ok((select eligible from public.get_reservation_payment_checkout(
              (select payment_attempt_id from mm3e2_two_attempt),
              (select id from public.organisations where slug = 'igloue'))),
          'historical released allocations do not invalidate normalized Checkout');

select * from public.persist_reservation_payment_checkout(
    (select payment_attempt_id from mm3e2_two_attempt),
    (select id from public.organisations where slug = 'igloue'),
    'cs_mm3e2_two', 'https://checkout.stripe.test/mm3e2-two', 'pi_mm3e2_two'
);
select is((select status from public.payment_attempts where id = (select payment_attempt_id from mm3e2_two_attempt)), 'checkout_open',
          'normalized persistence opens the reservation-level attempt');
select is((select provider_checkout_url from public.payment_attempts where id = (select payment_attempt_id from mm3e2_two_attempt)), 'https://checkout.stripe.test/mm3e2-two',
          'provider Checkout URL is persisted on the same attempt');
select is((select provider_payment_intent_id from public.payment_attempts where id = (select payment_attempt_id from mm3e2_two_attempt)), 'pi_mm3e2_two',
          'provider PaymentIntent remains linked to the same attempt');
select ok((select eligible from public.persist_reservation_payment_checkout(
              (select payment_attempt_id from mm3e2_two_attempt),
              (select id from public.organisations where slug = 'igloue'),
              'cs_mm3e2_two', 'https://checkout.stripe.test/mm3e2-two', 'pi_mm3e2_two')),
          'replaying the same persisted Checkout state remains eligible');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e2_two)), 1,
          'normalized Checkout does not create duplicate payment attempts');
select is((select payment_status from public.reservations where id = (select reservation_id from mm3e2_two)), 'not_started',
          'Checkout persistence does not mark payment paid');
select is((select count(*)::integer from public.outbox_events where aggregate_id = (select reservation_id from mm3e2_two)), 0,
          'Checkout persistence emits no confirmation outbox event');

create temporary table mm3e2_three as
select * from public.create_reservation_with_payment_capability(
    chr(92) || 'x' || repeat('b', 64),
    'MM3E2', 'Three', 'mm3e2-three@example.test', '0612345678', null,
    '2047-02-01 12:00:00+00', '2047-02-08 12:00:00+00',
    '2 MM3E2 Street', null, '16000', 'Angouleme', 'local',
    null, 29, 0, null, 256,
    '2047-02-01', '0830-1030', '2047-02-08', '1630-1830',
    'mm3e2-three-1', '2047-02-01 06:30:00', '2047-02-08 22:30:00',
    'Three', 'Recipient', '0612345678', 'personal', 'Three Recipient', null,
    'mm3e2-three@example.test', '2 MM3E2 Street', null, '16000', 'Angouleme', 'FR',
    null, null,
    '[{"product_id":"mm3e2-product-a","quantity":1},{"product_id":"mm3e2-product-b","quantity":1},{"product_id":"mm3e2-product-c","quantity":1}]'::jsonb
);
create temporary table mm3e2_three_attempt as
select * from public.initiate_reservation_payment(
    (select reservation_id from mm3e2_three), chr(92) || 'x' || repeat('b', 64), 'mm3e2-three-payment'
);
select ok((select eligible from public.get_reservation_payment_checkout(
              (select payment_attempt_id from mm3e2_three_attempt),
              (select id from public.organisations where slug = 'igloue'))),
          'normalized three-item Checkout eligibility succeeds');
select is((select amount from public.payment_attempts where id = (select payment_attempt_id from mm3e2_three_attempt)), 256.00::numeric,
          'three-item Checkout keeps the authoritative reservation amount');

update public.allocations
set status = 'released'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'missing current allocation rejects pre-Stripe Checkout');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e2_three)
  and status = 'released';

update public.allocations
set reservation_item_id = null
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'NULL-linked current allocation rejects pre-Stripe Checkout');
update public.allocations as a
set reservation_item_id = (
    select ri.id
    from public.reservation_items as ri
    join public.physical_machines as pm on pm.id = a.machine_id and pm.product_id = ri.product_id
    where ri.reservation_id = a.reservation_id
    limit 1
)
where a.reservation_id = (select reservation_id from mm3e2_three)
  and a.reservation_item_id is null;

update public.allocations
set status = 'reserved'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'reserved current allocation rejects pre-Stripe Checkout');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e2_three)
  and status = 'reserved';

update public.allocations
set status = 'active'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'active current allocation rejects pre-Stripe Checkout');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e2_three)
  and status = 'active';

insert into public.allocations (
    id, reservation_id, reservation_item_id, machine_id, status,
    operational_start, operational_end, hold_expires_at
) values (
    '00000000-0000-4000-8000-00000000e902',
    (select reservation_id from mm3e2_three),
    null,
    'mm3e2-machine-a-extra', 'held',
    '2047-02-01 05:30:00+00', '2047-02-08 21:30:00+00', now() + interval '30 minutes'
);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'unexpected current allocation rejects pre-Stripe Checkout');
delete from public.allocations where id = '00000000-0000-4000-8000-00000000e902';

update public.allocations
set hold_expires_at = null
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'NULL hold expiry rejects pre-Stripe Checkout');
update public.allocations
set hold_expires_at = now() + interval '30 minutes'
where reservation_id = (select reservation_id from mm3e2_three);

update public.allocations
set hold_expires_at = hold_expires_at + interval '1 minute'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'different shared expiry rejects pre-Stripe Checkout');
update public.allocations as a
set hold_expires_at = (
    select a2.hold_expires_at from public.allocations as a2
    where a2.reservation_id = a.reservation_id and a2.id <> a.id
    order by a2.id limit 1
)
where a.reservation_id = (select reservation_id from mm3e2_three)
  and a.id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);

update public.allocations
set operational_start = operational_start + interval '1 hour'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'mismatched operational range rejects pre-Stripe Checkout');
update public.allocations as a
set operational_start = (
    select a2.operational_start from public.allocations as a2
    where a2.reservation_id = a.reservation_id and a2.id <> a.id
    order by a2.id limit 1
)
where a.reservation_id = (select reservation_id from mm3e2_three)
  and a.id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);

update public.allocations
set operational_end = operational_end + interval '1 hour'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'mismatched operational end rejects pre-Stripe Checkout');
update public.allocations as a
set operational_end = (
    select a2.operational_end from public.allocations as a2
    where a2.reservation_id = a.reservation_id and a2.id <> a.id
    order by a2.id limit 1
)
where a.reservation_id = (select reservation_id from mm3e2_three)
  and a.id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);

update public.reservation_items as ri
set product_id = 'mm3e2-product-c'
where ri.id = (
    select a.reservation_item_id
    from public.allocations as a
    join public.physical_machines as pm on pm.id = a.machine_id
    where a.reservation_id = (select reservation_id from mm3e2_three)
      and pm.product_id = 'mm3e2-product-a'
    order by a.id limit 1
);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'machine/product mismatch rejects pre-Stripe Checkout');
update public.reservation_items as ri
set product_id = 'mm3e2-product-a'
where ri.id = (
    select a.reservation_item_id
    from public.allocations as a
    join public.physical_machines as pm on pm.id = a.machine_id
    where a.reservation_id = (select reservation_id from mm3e2_three)
      and pm.product_id = 'mm3e2-product-a'
    order by a.id limit 1
);

update public.allocations
set hold_expires_at = now() + interval '10 minutes'
where reservation_id = (select reservation_id from mm3e2_three);
select throws_ok($$select * from public.get_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'))$$,
                 'P0001', null, 'less than eleven minutes rejects a new Stripe Checkout call');
update public.allocations
set hold_expires_at = now() + interval '30 minutes'
where reservation_id = (select reservation_id from mm3e2_three);

update public.allocations
set status = 'released'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.persist_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'), 'cs_mm3e2_missing-post', 'https://checkout.stripe.test/mm3e2-missing-post', null)$$,
                 'P0001', null, 'missing allocation rejects post-Stripe persistence');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e2_three)
  and status = 'released';

update public.allocations
set status = 'reserved'
where reservation_id = (select reservation_id from mm3e2_three)
  and id = (select id from public.allocations where reservation_id = (select reservation_id from mm3e2_three) order by id limit 1);
select throws_ok($$select * from public.persist_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'), 'cs_mm3e2_reserved-post', 'https://checkout.stripe.test/mm3e2-reserved-post', null)$$,
                 'P0001', null, 'reserved allocation rejects post-Stripe persistence');
update public.allocations
set status = 'held'
where reservation_id = (select reservation_id from mm3e2_three)
  and status = 'reserved';

update public.allocations
set hold_expires_at = now() - interval '1 minute'
where reservation_id = (select reservation_id from mm3e2_three);
select throws_ok($$select * from public.persist_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'), 'cs_mm3e2_expired-post', 'https://checkout.stripe.test/mm3e2-expired-post', null)$$,
                 'P0001', null, 'expired hold rejects post-Stripe persistence');
select is((select provider_checkout_session_id from public.payment_attempts where id = (select payment_attempt_id from mm3e2_three_attempt)), null,
          'failed post-Stripe validation does not persist a provider session');
update public.allocations
set hold_expires_at = now() + interval '30 minutes'
where reservation_id = (select reservation_id from mm3e2_three);

update public.reservations
set status = 'cancelled'
where id = (select reservation_id from mm3e2_three);
select throws_ok($$select * from public.persist_reservation_payment_checkout((select payment_attempt_id from mm3e2_three_attempt), (select id from public.organisations where slug = 'igloue'), 'cs_mm3e2_cancelled', 'https://checkout.stripe.test/mm3e2-cancelled', null)$$,
                 'P0001', null, 'cancellation during Stripe boundary rejects persistence');
select is((select provider_checkout_session_id from public.payment_attempts where id = (select payment_attempt_id from mm3e2_three_attempt)), null,
          'failed cancellation persistence does not store a provider session');
select is((select payment_status from public.reservations where id = (select reservation_id from mm3e2_three)), 'not_started',
          'failed persistence does not mark payment paid');
select is((select count(*)::integer from public.payment_attempts where reservation_id = (select reservation_id from mm3e2_three)), 1,
          'failed persistence does not create a duplicate attempt');

select * from finish();
rollback;

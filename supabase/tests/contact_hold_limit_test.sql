begin;

select plan(30);

insert into public.physical_machines (id, product_id, serial_number, status, active)
select 'TEST-CONTACT-' || n, 'essential', 'TEST-CONTACT-SERIAL-' || n, 'available', true
from generate_series(1, 10) as n;

-- Test-only wrapper: all calls exercise the actual 24-argument transaction.
create function pg_temp.book_contact(email text, booking_key text, product text default 'essential')
returns table(customer_id uuid, reservation_id uuid, delivery_job_id uuid,
    collection_job_id uuid, allocation_id uuid, machine_id text,
    reservation_status text, hold_expires_at timestamptz)
language sql as $$
    select customer_id, reservation_id, delivery_job_id, collection_job_id,
        allocation_id, machine_id, reservation_status, hold_expires_at
    from public.create_reservation_transaction(
        'Contact', 'Limit', email, '0600000000', product,
        '2036-07-12 12:00:00+00', '2036-07-19 12:00:00+00',
        '10 Rue Test', null, '16000', 'Angouleme', 'local',
        59, 29, 19, 250, 107, '2036-07-12', '0830-1030',
        '2036-07-19', '1630-1830', booking_key,
        '2036-07-12 06:30:00', '2036-07-19 22:30:00'
    );
$$;

-- The RPC temporarily resolves a different organisation in this rolled-back
-- fixture. Two held bookings there must not consume IGLOUE's allowance.
update public.organisations set slug = 'contact-test-original' where slug = 'igloue';
insert into public.organisations (slug, name) values ('igloue', 'Contact test tenant');
create temporary table other_first as select * from pg_temp.book_contact('contact@example.com', 'contact-other-1');
create temporary table other_second as select * from pg_temp.book_contact('contact@example.com', 'contact-other-2');
update public.organisations set slug = 'contact-test-other' where slug = 'igloue';
update public.organisations set slug = 'igloue' where slug = 'contact-test-original';

create temporary table first_hold as select * from pg_temp.book_contact(' Contact@Example.com ', 'contact-first');
create temporary table second_hold as select * from pg_temp.book_contact('contact@example.com', 'contact-second');
select is((select reservation_status from first_hold), 'pending', 'first hold succeeds despite other-tenant holds');
select is((select reservation_status from second_hold), 'pending', 'second normalized-contact hold succeeds');
select is((select email from public.customers where id = (select customer_id from first_hold)),
    ' Contact@Example.com ', 'normalization does not rewrite customer email');

create temporary table before_rejection as select
    (select count(*) from public.customers) as customers,
    (select count(*) from public.reservations) as reservations,
    (select count(*) from public.service_jobs) as jobs,
    (select count(*) from public.allocations) as allocations;
select throws_ok($$select * from pg_temp.book_contact(' CONTACT@example.COM ', 'contact-third')$$,
    'P1001', 'Too many active holds', 'third new normalized-contact hold is rejected');
select is((select count(*) from public.customers), (select customers from before_rejection), 'blocked request creates no customer');
select is((select count(*) from public.reservations), (select reservations from before_rejection), 'blocked request creates no reservation');
select is((select count(*) from public.service_jobs), (select jobs from before_rejection), 'blocked request creates no service jobs');
select is((select count(*) from public.allocations), (select allocations from before_rejection), 'blocked request creates no allocation');

create temporary table retry_hold as select * from pg_temp.book_contact(' Contact@Example.com ', 'contact-first');
select results_eq('select * from retry_hold', 'select * from first_hold', 'identical retry at limit returns every original RPC field');
select throws_ok($$select * from pg_temp.book_contact('contact@example.com', 'contact-first', 'mobile-duo')$$,
    'P0003', 'idempotency key payload conflict', 'mismatched retry retains conflict before contact guard');
select lives_ok($$select * from pg_temp.book_contact('different@example.com', 'contact-different')$$,
    'different contact can create a hold');

update public.allocations set hold_expires_at = now() - interval '1 minute'
where id = (select allocation_id from first_hold);
select throws_ok($$select * from pg_temp.book_contact('contact@example.com', 'contact-expired-block')$$,
    'P1001', 'Too many active holds', 'expired but still held allocation continues counting');
select public.expire_reservation_hold((select reservation_id from first_hold));
select is((select status from public.allocations where id = (select allocation_id from first_hold)),
    'released', 'lifecycle releases the expired allocation');
select lives_ok($$select * from pg_temp.book_contact('contact@example.com', 'contact-after-release')$$,
    'released allocation no longer consumes allowance');

create temporary table cancelled_retry as select * from pg_temp.book_contact(' Contact@Example.com ', 'contact-first');
select is((select reservation_id from cancelled_retry), (select reservation_id from first_hold), 'cancelled retry returns original reservation');
select is((select reservation_status from cancelled_retry), 'cancelled', 'cancelled retry remains cancelled');
select ok((select allocation_id is null and machine_id is null and hold_expires_at is null from cancelled_retry),
    'cancelled retry does not return released allocation or expiry');

select public.confirm_reservation((select reservation_id from second_hold));
select is((select status from public.allocations where id = (select allocation_id from second_hold)),
    'reserved', 'confirmation reserves the allocation');
select lives_ok($$select * from pg_temp.book_contact('contact@example.com', 'contact-after-confirm')$$,
    'confirmed/reserved booking no longer consumes pending allowance');

-- Inspect actual transaction locks, not merely the source text.
select ok(exists (
    select 1 from pg_catalog.pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and mode = 'ExclusiveLock' and objsubid = 1
      and ((classid::bigint << 32) | objid::bigint) = pg_catalog.hashtextextended(
          'igloue:pending-contact-holds:' || (select id::text from public.organisations where slug = 'igloue')
          || ':contact@example.com', 0)
), 'actual tenant/contact exclusive transaction lock is held');
select isnt(
    pg_catalog.hashtextextended('igloue:pending-contact-holds:' || (select id::text from public.organisations where slug = 'igloue') || ':contact@example.com', 0),
    pg_catalog.hashtextextended('igloue:pending-contact-holds:' || (select id::text from public.organisations where slug = 'contact-test-other') || ':contact@example.com', 0),
    'same email in distinct organisations has distinct lock keys');

create temporary table rpc_definition as
select oid, prosrc, prosecdef, proconfig, proacl
from pg_catalog.pg_proc
where pronamespace = 'public'::regnamespace and proname = 'create_reservation_transaction';
select ok((select strpos(prosrc, 'igloue:pending-contact-holds:') < strpos(prosrc, 'select count(*)')
    and strpos(prosrc, 'select count(*)') < strpos(prosrc, 'insert into public.customers')
    and strpos(prosrc, 'igloue:pending-contact-holds:') > strpos(prosrc, 'idempotency key payload conflict')
    from rpc_definition), 'contact lock precedes count and writes, after idempotency handling');
select is((select count(*) from rpc_definition), 1::bigint, 'only one reservation RPC exists');
select is((select pronargs::integer from pg_catalog.pg_proc where oid = (select oid from rpc_definition)), 24, 'RPC retains 24 arguments');
select ok((select not prosecdef from rpc_definition), 'RPC remains SECURITY INVOKER');
select ok((select proconfig @> array['search_path=""'] from rpc_definition), 'RPC retains empty search_path');
select ok(has_function_privilege('service_role', (select oid from rpc_definition), 'EXECUTE'), 'backend retains execution');
select ok(not has_function_privilege('anon', (select oid from rpc_definition), 'EXECUTE'), 'anon has no execution');
select ok(not has_function_privilege('authenticated', (select oid from rpc_definition), 'EXECUTE'), 'authenticated has no execution');
select ok(not exists (select 1 from rpc_definition,
    lateral aclexplode(coalesce(proacl, acldefault('f', (select proowner from pg_proc where oid = rpc_definition.oid)))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), 'PUBLIC has no execution');

select * from finish();
rollback;

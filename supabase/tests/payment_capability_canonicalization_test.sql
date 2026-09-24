begin;

select plan(8);

select ok(
    not exists (
        select 1 from public.reservation_payment_capabilities
        where length(capability_hash) <> 66
           or left(capability_hash, 2) <> chr(92) || 'x'
           or substring(capability_hash from 3) !~ '^[0-9a-f]{64}$'
    ),
    'all stored capability hashes use canonical representation'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conname = 'reservation_payment_capabilities_hash_check'
          and pg_get_constraintdef(oid) like '%length(capability_hash) = 66%'
    ),
    'canonical hash constraint is installed'
);

select throws_ok($$
    insert into public.reservation_payment_capabilities (
        organisation_id, reservation_id, capability_hash, expires_at
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-4000-8000-00000000c001',
        chr(92) || chr(92) || 'x' || repeat('a', 64),
        now() + interval '30 minutes'
    )
$$, '23514', null, 'legacy double-backslash hash is rejected');

select throws_ok($$
    insert into public.reservation_payment_capabilities (
        organisation_id, reservation_id, capability_hash, expires_at
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-4000-8000-00000000c002',
        chr(92) || 'x' || repeat('A', 64),
        now() + interval '30 minutes'
    )
$$, '23514', null, 'uppercase hash is rejected');

select throws_ok($$
    insert into public.reservation_payment_capabilities (
        organisation_id, reservation_id, capability_hash, expires_at
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-4000-8000-00000000c003',
        chr(92) || 'x' || repeat('a', 63),
        now() + interval '30 minutes'
    )
$$, '23514', null, 'short hash is rejected');

select ok(
    exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'create_reservation_with_payment_capability'
          and pronargs = 25
          and not prosecdef
          and position(repeat(chr(92), 4) || 'x[0-9a-f]' in pg_get_functiondef(oid)) = 0
          and position(repeat(chr(92), 2) || 'x[0-9a-f]' in pg_get_functiondef(oid)) > 0
    ),
    'reservation capability wrapper uses canonical validation'
);

select ok(
    exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'initiate_reservation_payment'
          and position(repeat(chr(92), 4) || 'x[0-9a-f]' in pg_get_functiondef(oid)) = 0
          and position(repeat(chr(92), 2) || 'x[0-9a-f]' in pg_get_functiondef(oid)) > 0
    ),
    'payment initiation uses canonical validation'
);

select ok(
    not exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('create_reservation_with_payment_capability', 'initiate_reservation_payment')
          and pg_get_functiondef(oid) like '%v_legacy_capability_hash%'
    ),
    'SQL functions contain no legacy normalization bridge'
);

select * from finish();
rollback;

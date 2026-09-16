begin;

select plan(8);

select ok(
    to_regclass('public.organisations') is not null,
    'organisations table exists'
);

select is(
    (
        select count(*)::integer
        from public.organisations
        where slug = 'igloue'
    ),
    1,
    'IGLOUE bootstrap organisation exists exactly once'
);

select is(
    (
        select relrowsecurity
        from pg_class
        where oid = 'public.organisations'::regclass
    ),
    true,
    'organisations has row level security enabled'
);

select is(
    (
        select count(*)::integer
        from pg_policies
        where schemaname = 'public'
          and tablename = 'organisations'
    ),
    0,
    'organisations has no browser access policies yet'
);

select lives_ok(
    $$
        insert into public.organisations (
            slug,
            name,
            status,
            default_currency,
            timezone
        )
        values (
            'igloue',
            'Duplicate IGLOUE',
            'active',
            'EUR',
            'Europe/Paris'
        )
        on conflict (slug) do nothing
    $$,
    'reapplying the IGLOUE bootstrap is idempotent'
);

select is(
    (
        select count(*)::integer
        from public.organisations
        where slug = 'igloue'
    ),
    1,
    'idempotent bootstrap still leaves one IGLOUE organisation'
);

select throws_ok(
    $$
        insert into public.organisations (
            slug,
            name,
            status,
            default_currency,
            timezone
        )
        values (
            'igloue',
            'Duplicate IGLOUE',
            'active',
            'EUR',
            'Europe/Paris'
        )
    $$,
    '23505',
    null,
    'organisation slug is unique'
);

select ok(
    not has_table_privilege('anon', 'public.organisations', 'INSERT')
    and not has_table_privilege('anon', 'public.organisations', 'UPDATE')
    and not has_table_privilege('anon', 'public.organisations', 'DELETE')
    and not has_table_privilege('authenticated', 'public.organisations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.organisations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.organisations', 'DELETE'),
    'browser roles have no organisation write privileges'
);

select * from finish();

rollback;

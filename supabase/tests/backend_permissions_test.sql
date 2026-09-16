begin;

select plan(14);

-- Trusted backend role: permissions required by create_machine_hold.

select ok(
    has_table_privilege(
        'service_role',
        'public.customers',
        'SELECT'
    ),
    'service_role can select customers'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.customers',
        'INSERT'
    ),
    'service_role can create customers'
);

select ok(
    not has_table_privilege('anon', 'public.customers', 'SELECT')
    and not has_table_privilege('anon', 'public.customers', 'INSERT')
    and not has_table_privilege('anon', 'public.customers', 'UPDATE')
    and not has_table_privilege('anon', 'public.customers', 'DELETE')
    and not has_table_privilege('anon', 'public.customers', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.customers', 'REFERENCES')
    and not has_table_privilege('anon', 'public.customers', 'TRIGGER'),
    'anon has no direct customer table privileges'
);

select ok(
    not has_table_privilege('authenticated', 'public.customers', 'SELECT')
    and not has_table_privilege('authenticated', 'public.customers', 'INSERT')
    and not has_table_privilege('authenticated', 'public.customers', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.customers', 'DELETE')
    and not has_table_privilege('authenticated', 'public.customers', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.customers', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.customers', 'TRIGGER'),
    'authenticated has no direct customer table privileges'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.reservations',
        'SELECT'
    ),
    'service_role can select reservations'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.reservations',
        'UPDATE'
    ),
    'service_role can lock/update reservations'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.physical_machines',
        'SELECT'
    ),
    'service_role can select physical machines'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.physical_machines',
        'UPDATE'
    ),
    'service_role can lock/update physical machines'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.allocations',
        'SELECT'
    ),
    'service_role can select allocations'
);

select ok(
    has_table_privilege(
        'service_role',
        'public.allocations',
        'INSERT'
    ),
    'service_role can create machine holds'
);

select ok(
    has_function_privilege(
        'service_role',
        'public.create_machine_hold(uuid,timestamp with time zone,timestamp with time zone)',
        'EXECUTE'
    ),
    'service_role can execute create_machine_hold'
);

-- Public website role must not receive these backend privileges.

select ok(
    not has_table_privilege(
        'anon',
        'public.physical_machines',
        'UPDATE'
    ),
    'anon cannot update physical machines'
);

select ok(
    not has_table_privilege(
        'anon',
        'public.allocations',
        'INSERT'
    ),
    'anon cannot create allocations'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.create_machine_hold(uuid,timestamp with time zone,timestamp with time zone)',
        'EXECUTE'
    ),
    'anon cannot execute create_machine_hold'
);

select * from finish();

rollback;

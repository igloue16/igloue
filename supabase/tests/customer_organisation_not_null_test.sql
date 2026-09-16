begin;

select plan(5);

select is(
    (
        select udt_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name = 'organisation_id'
    ),
    'uuid',
    'organisation_id is uuid'
);

select ok(
    coalesce((
        select is_nullable = 'NO'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name = 'organisation_id'
    ), false),
    'organisation_id is NOT NULL at schema level'
);

select is(
    (
        select count(*)::integer
        from public.customers
        where organisation_id is null
    ),
    0,
    'existing customers all have organisation ownership'
);

select throws_ok(
    $$
        insert into public.customers (first_name, last_name, email)
        values ('Batch5', 'Null', 'batch5-null-customer@example.com')
    $$,
    '23502',
    null,
    'direct customer insert without organisation_id fails'
);

select ok(
    not exists (
        select 1
        from public.customers
        where email = 'batch5-null-customer@example.com'
    ),
    'failed NULL customer insert leaves no row'
);

select * from finish();

rollback;

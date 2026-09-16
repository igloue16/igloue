begin;

select plan(8);

select ok(
    exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name = 'organisation_id'
    ),
    'customers.organisation_id exists'
);

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
    not coalesce((
        select is_nullable = 'NO'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name = 'organisation_id'
    ), false),
    'organisation_id remains nullable'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conrelid = 'public.customers'::regclass
          and contype = 'f'
          and confrelid = 'public.organisations'::regclass
          and conkey = array[
              (select attnum
               from pg_attribute
               where attrelid = 'public.customers'::regclass
                 and attname = 'organisation_id'
                 and not attisdropped)
          ]::smallint[]
          and confkey = array[
              (select attnum
               from pg_attribute
               where attrelid = 'public.organisations'::regclass
                 and attname = 'id'
                 and not attisdropped)
          ]::smallint[]
    ),
    'organisation_id references organisations(id)'
);

select ok(
    exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'customers'
          and indexdef ilike '%(organisation_id)%'
    ),
    'customers has an organisation_id index'
);

select is(
    (
        select count(*)::integer
        from public.customers as c
        left join public.organisations as o
          on o.id = c.organisation_id
        where c.organisation_id is null
           or o.slug <> 'igloue'
           or o.id is null
    ),
    0,
    'all existing customers belong to the IGLOUE organisation'
);

select ok(
    (
        select relrowsecurity
        from pg_class
        where oid = 'public.customers'::regclass
    ),
    'customers RLS remains enabled'
);

select ok(
    not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'customers'
          and (
              coalesce(qual, '') ilike '%organisation_id%'
              or coalesce(with_check, '') ilike '%organisation_id%'
          )
    ),
    'Batch 2 adds no organisation_id-specific customer access policy'
);

select * from finish();

rollback;

begin;

select plan(45);

select has_table('public', 'reservation_items', 'reservation_items exists');
select has_column('public', 'reservation_items', 'id', 'reservation_items has id');
select col_is_pk('public', 'reservation_items', 'id', 'reservation_items id is primary key');
select col_type_is('public', 'reservation_items', 'id', 'uuid', 'reservation_items id is uuid');
select ok(
    (select column_default is not null
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservation_items'
       and column_name = 'id'),
    'reservation_items id has a default'
);
select col_not_null('public', 'reservation_items', 'organisation_id', 'organisation_id is required');
select col_not_null('public', 'reservation_items', 'reservation_id', 'reservation_id is required');
select col_not_null('public', 'reservation_items', 'product_id', 'product_id is required');
select col_not_null('public', 'reservation_items', 'unit_rental_price', 'unit_rental_price is required');
select col_not_null('public', 'reservation_items', 'line_total', 'line_total is required');
select col_not_null('public', 'reservation_items', 'created_at', 'created_at is required');
select ok(
    (select column_default is not null
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservation_items'
       and column_name = 'created_at'),
    'created_at has a default'
);
select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservation_items'
          and column_name = 'quantity'
    ),
    'reservation_items has no quantity column'
);

select has_column('public', 'allocations', 'reservation_item_id', 'allocations has reservation_item_id');
select ok(
    (select is_nullable = 'YES'
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'allocations'
       and column_name = 'reservation_item_id'),
    'legacy allocation item link is nullable'
);

select ok(
    has_table_privilege('service_role', 'public.reservation_items', 'SELECT')
    and has_table_privilege('service_role', 'public.reservation_items', 'INSERT'),
    'service_role has intended reservation item privileges'
);

select ok(
    not has_table_privilege('public', 'public.reservation_items', 'INSERT'),
    'PUBLIC cannot insert reservation items'
);

select ok(
    not has_table_privilege('anon', 'public.reservation_items', 'INSERT'),
    'anon cannot insert reservation items'
);

select ok(
    not has_table_privilege('authenticated', 'public.reservation_items', 'INSERT'),
    'authenticated cannot insert reservation items'
);

select ok(
    (select relrowsecurity from pg_class where oid = 'public.reservation_items'::regclass),
    'reservation_items has RLS enabled'
);

select ok(
    not exists (
        select 1
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and prosecdef
          and proname like '%reservation_item%'
    ),
    'no reservation item SECURITY DEFINER function was added'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conname = 'reservation_items_reservation_organisation_fkey'
    ),
    'reservation item organisation is tied to reservation organisation'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conname = 'allocations_reservation_item_reservation_fkey'
    ),
    'allocation item link is tied to its reservation'
);

select ok(
    exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and tablename = 'allocations'
          and indexname = 'allocations_one_item_one_allocation_uidx'
    ),
    'one reservation item has at most one allocation index'
);

select ok(
    exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and tablename = 'reservation_items'
          and indexname = 'reservation_items_reservation_id_idx'
    ),
    'reservation item lookup index exists'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conname = 'reservations_id_organisation_unique'
    ),
    'reservation composite key supports tenant-safe item linkage'
);

select ok(
    exists (
        select 1 from pg_constraint
        where conname = 'reservation_items_product_fkey'
    ),
    'reservation item product uses the global product foreign key'
);

select ok(
    exists (select 1 from pg_constraint
            where conname = 'reservation_items_unit_rental_price_non_negative'),
    'unit rental price is non-negative'
);

select ok(
    exists (select 1 from pg_constraint
            where conname = 'reservation_items_line_total_non_negative'),
    'line total is non-negative'
);

select ok(
    exists (select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'reservations'
              and column_name = 'product_id')
    and exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'reservations'
                  and column_name = 'quantity'),
    'legacy reservation product and quantity columns remain'
);

select ok(
    not exists (select 1 from public.reservation_items),
    'MM1 does not backfill reservation items'
);

insert into public.organisations (id, slug, name)
values ('00000000-0000-0000-0000-000000000002', 'mm1-test-org', 'MM1 Test Organisation');

insert into public.products (id, name, weekly_price, deposit_amount)
values
    ('mm1-product-a', 'MM1 Product A', 59.00, 250.00),
    ('mm1-product-b', 'MM1 Product B', 79.00, 350.00);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values
    ('00000000-0000-0000-0000-000000000201',
     (select id from public.organisations where slug = 'igloue'),
     'MM1', 'Primary', 'mm1-primary@example.com'),
    ('00000000-0000-0000-0000-000000000202',
     '00000000-0000-0000-0000-000000000002',
     'MM1', 'Secondary', 'mm1-secondary@example.com');

insert into public.reservations (
    id, organisation_id, customer_id, product_id, quantity,
    rental_start, rental_end, delivery_address_line_1,
    delivery_postcode, delivery_city, weekly_price_at_booking,
    deposit_amount, total_amount
)
values
    ('00000000-0000-0000-0000-000000000301',
     (select id from public.organisations where slug = 'igloue'),
     '00000000-0000-0000-0000-000000000201', 'mm1-product-a', 1,
     '2037-01-01 10:00:00+00', '2037-01-07 10:00:00+00',
     '1 MM1 Street', '16000', 'Angouleme', 59.00, 250.00, 59.00),
    ('00000000-0000-0000-0000-000000000302',
     '00000000-0000-0000-0000-000000000002',
     '00000000-0000-0000-0000-000000000202', 'mm1-product-a', 1,
     '2037-01-01 10:00:00+00', '2037-01-07 10:00:00+00',
     '2 MM1 Street', '16000', 'Angouleme', 59.00, 250.00, 59.00);

select lives_ok($$
    insert into public.reservation_items (
        id, organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    )
    values (
        '00000000-0000-0000-0000-000000000401',
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000301',
        'mm1-product-a', 59.00, 59.00
    )
$$, 'same-organisation reservation item succeeds');

select is(
    (select count(*)::integer from public.reservation_items),
    1,
    'one reservation item was inserted'
);

select throws_ok($$
    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    ) values (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000301',
        'mm1-product-a', 59.00, 59.00
    )
$$, '23503', null, 'cross-organisation reservation item is rejected');

select throws_ok($$
    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000399',
        'mm1-product-a', 59.00, 59.00
    )
$$, '23503', null, 'invalid reservation is rejected');

select throws_ok($$
    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000301',
        'mm1-missing-product', 59.00, 59.00
    )
$$, '23503', null, 'invalid product is rejected');

insert into public.reservation_items (
    id, organisation_id, reservation_id, product_id,
    unit_rental_price, line_total
)
values (
    '00000000-0000-0000-0000-000000000402',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000000301',
    'mm1-product-b', 79.00, 79.00
), (
    '00000000-0000-0000-0000-000000000403',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000302',
    'mm1-product-a', 59.00, 59.00
);

insert into public.physical_machines (id, product_id, status)
values
    ('mm1-machine-a', 'mm1-product-a', 'available'),
    ('mm1-machine-b', 'mm1-product-a', 'available'),
    ('mm1-machine-c', 'mm1-product-b', 'available'),
    ('mm1-machine-d', 'mm1-product-a', 'available');

select lives_ok($$
    insert into public.allocations (
        reservation_id, machine_id, reservation_item_id,
        status, operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000301', 'mm1-machine-a',
        '00000000-0000-0000-0000-000000000401', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, 'valid reservation item allocation link succeeds');

select lives_ok($$
    insert into public.allocations (
        reservation_id, machine_id, status,
        operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000301', 'mm1-machine-b', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, 'legacy allocation with NULL reservation_item_id remains valid');

select throws_ok($$
    insert into public.allocations (
        reservation_id, machine_id, reservation_item_id,
        status, operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000301', 'mm1-machine-d',
        '00000000-0000-0000-0000-000000000403', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, '23503', null, 'item from another organisation cannot be linked');

select throws_ok($$
    insert into public.allocations (
        reservation_id, machine_id, reservation_item_id,
        status, operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000302', 'mm1-machine-c',
        '00000000-0000-0000-0000-000000000402', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, '23503', null, 'item from another reservation cannot be linked');

select throws_ok($$
    insert into public.allocations (
        reservation_id, machine_id, reservation_item_id,
        status, operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000301', 'mm1-machine-d',
        '00000000-0000-0000-0000-000000000401', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, '23505', null, 'one reservation item cannot receive two allocations');

select lives_ok($$
    insert into public.allocations (
        reservation_id, machine_id, reservation_item_id,
        status, operational_start, operational_end
    ) values (
        '00000000-0000-0000-0000-000000000301', 'mm1-machine-c',
        '00000000-0000-0000-0000-000000000402', 'held',
        '2037-01-01 08:00:00+00', '2037-01-07 12:00:00+00'
    )
$$, 'different reservation items may each receive an allocation');

select throws_ok($$
    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000301',
        'mm1-product-a', -1.00, 1.00
    )
$$, '23514', null, 'negative unit rental price is rejected');

select throws_ok($$
    insert into public.reservation_items (
        organisation_id, reservation_id, product_id,
        unit_rental_price, line_total
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000301',
        'mm1-product-a', 1.00, -1.00
    )
$$, '23514', null, 'negative line total is rejected');

update public.products
set weekly_price = 999.00
where id = 'mm1-product-a';

select is(
    (select unit_rental_price from public.reservation_items
     where id = '00000000-0000-0000-0000-000000000401'),
    59.00::numeric,
    'catalog price changes do not mutate item price snapshots'
);

select * from finish();

rollback;

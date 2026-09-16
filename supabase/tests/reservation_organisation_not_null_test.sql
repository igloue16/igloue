begin;

select plan(5);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'organisation_id'
    ),
    'reservations.organisation_id exists'
);

select is(
    (select udt_name from information_schema.columns
     where table_schema = 'public' and table_name = 'reservations'
       and column_name = 'organisation_id'),
    'uuid',
    'reservations.organisation_id remains uuid'
);

select ok(
    coalesce((select is_nullable = 'NO' from information_schema.columns
              where table_schema = 'public' and table_name = 'reservations'
                and column_name = 'organisation_id'), false),
    'reservations.organisation_id is NOT NULL'
);

insert into public.customers (id, organisation_id, first_name, last_name, email)
values (
    '00000000-0000-0000-0000-000000000801',
    (select id from public.organisations where slug = 'igloue'),
    'Batch8', 'Null', 'batch8-null-reservation@example.com'
);

select throws_ok(
    $$
        insert into public.reservations (
            id, customer_id, product_id, rental_start, rental_end,
            delivery_address_line_1, delivery_postcode, delivery_city,
            weekly_price_at_booking, deposit_amount, total_amount
        ) values (
            '00000000-0000-0000-0000-000000000801',
            '00000000-0000-0000-0000-000000000801', 'essential',
            '2027-03-01 10:00:00+00', '2027-03-04 10:00:00+00',
            '8 Rue Batch8', '16000', 'Angouleme', 59, 250, 59
        )
    $$,
    '23502', null,
    'direct reservation insert without organisation_id fails'
);

select ok(
    not exists (select 1 from public.reservations
                where id = '00000000-0000-0000-0000-000000000801'),
    'failed NULL reservation insert leaves no row'
);

select * from finish();

rollback;

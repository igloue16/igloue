begin;

select plan(52);

select has_column('public', 'reservations', 'recipient_first_name', 'recipient first name exists');
select has_column('public', 'reservations', 'recipient_last_name', 'recipient last name exists');
select has_column('public', 'reservations', 'recipient_phone', 'recipient phone exists');

select has_table('public', 'reservation_billing_details', 'billing snapshot table exists');
select col_is_pk('public', 'reservation_billing_details', 'id', 'billing snapshot id is primary key');
select col_type_is('public', 'reservation_billing_details', 'id', 'uuid', 'billing snapshot id is uuid');
select col_not_null('public', 'reservation_billing_details', 'organisation_id', 'billing organisation is required');
select col_not_null('public', 'reservation_billing_details', 'reservation_id', 'billing reservation is required');
select col_not_null('public', 'reservation_billing_details', 'billing_mode', 'billing mode is required');
select col_not_null('public', 'reservation_billing_details', 'billing_name', 'billing name is required');
select col_not_null('public', 'reservation_billing_details', 'billing_email', 'billing email is required');
select col_not_null('public', 'reservation_billing_details', 'billing_address_line_1', 'billing address line 1 is required');
select col_not_null('public', 'reservation_billing_details', 'billing_postcode', 'billing postcode is required');
select col_not_null('public', 'reservation_billing_details', 'billing_city', 'billing city is required');
select col_not_null('public', 'reservation_billing_details', 'billing_country', 'billing country is required');
select col_not_null('public', 'reservation_billing_details', 'created_at', 'billing created_at is required');
select ok(
    (select column_default is not null
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservation_billing_details'
       and column_name = 'created_at'),
    'billing created_at has a default'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conname = 'reservation_billing_details_mode_check'
    ),
    'billing mode is controlled'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conname = 'reservation_billing_details_reservation_unique'
    ),
    'billing details are one-to-one with reservations'
);

select ok(
    exists (
        select 1
        from pg_constraint
        where conname = 'reservation_billing_details_reservation_organisation_fkey'
    ),
    'billing relationship is organisation-safe'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservation_billing_details'
          and column_name in (
              'vat_number', 'siren', 'siret', 'invoice_number',
              'accounting_status', 'tax_amount', 'stripe_customer_id',
              'card_number', 'payment_method', 'card_token'
          )
    ),
    'billing table has no deferred accounting or payment credentials'
);

select ok(
    not exists (
        select 1
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and prosecdef
          and proname like '%billing%'
    ),
    'no billing SECURITY DEFINER function was added'
);

select ok(
    (select relrowsecurity from pg_class where oid = 'public.reservation_billing_details'::regclass),
    'billing table has RLS enabled'
);

select ok(
    has_table_privilege('service_role', 'public.reservation_billing_details', 'SELECT')
    and has_table_privilege('service_role', 'public.reservation_billing_details', 'INSERT')
    and not has_table_privilege('service_role', 'public.reservation_billing_details', 'UPDATE')
    and not has_table_privilege('service_role', 'public.reservation_billing_details', 'DELETE'),
    'service_role has minimum billing snapshot privileges'
);

select ok(
    not has_table_privilege('public', 'public.reservation_billing_details', 'INSERT'),
    'PUBLIC cannot insert billing snapshots'
);

select ok(
    not has_table_privilege('anon', 'public.reservation_billing_details', 'INSERT'),
    'anon cannot insert billing snapshots'
);

select ok(
    not has_table_privilege('authenticated', 'public.reservation_billing_details', 'INSERT'),
    'authenticated cannot insert billing snapshots'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservation_billing_details'
          and column_name in ('item_id', 'reservation_item_id')
    ),
    'billing details are not duplicated per reservation item'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name in ('address_line_1', 'company_name', 'recipient_first_name', 'payer_id', 'stripe_customer_id')
    ),
    'customer schema has no MM1C additions'
);

select ok(
    not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservation_items'
          and column_name in ('recipient_first_name', 'billing_name', 'billing_mode')
    ),
    'reservation items have no reservation-context fields'
);

select ok(
    exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'delivery_address_line_1'
    ),
    'reservation delivery address remains on reservations'
);

insert into public.organisations (id, slug, name)
values ('00000000-0000-0000-0000-000000000012', 'mm1c-test-org', 'MM1C Test Organisation');

insert into public.products (id, name, weekly_price, deposit_amount)
values ('mm1c-product', 'MM1C Product', 59.00, 250.00);

insert into public.customers (id, organisation_id, first_name, last_name, email, phone)
values (
    '00000000-0000-0000-0000-000000000121',
    (select id from public.organisations where slug = 'igloue'),
    'MM1C', 'Customer', 'mm1c-customer@example.com', '0612345678'
);

insert into public.reservations (
    id, organisation_id, customer_id, product_id, quantity,
    rental_start, rental_end, delivery_address_line_1,
    delivery_postcode, delivery_city, weekly_price_at_booking,
    deposit_amount, total_amount
)
values (
    '00000000-0000-0000-0000-000000000131',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000000121', 'mm1c-product', 1,
    '2037-02-01 10:00:00+00', '2037-02-07 10:00:00+00',
    '1 MM1C Street', '16000', 'Angouleme', 59.00, 250.00, 59.00
), (
    '00000000-0000-0000-0000-000000000132',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000000121', 'mm1c-product', 1,
    '2037-02-01 10:00:00+00', '2037-02-07 10:00:00+00',
    '2 MM1C Street', '16000', 'Angouleme', 59.00, 250.00, 59.00
), (
    '00000000-0000-0000-0000-000000000134',
    (select id from public.organisations where slug = 'igloue'),
    '00000000-0000-0000-0000-000000000121', 'mm1c-product', 1,
    '2037-02-01 10:00:00+00', '2037-02-07 10:00:00+00',
    '4 MM1C Street', '16000', 'Angouleme', 59.00, 250.00, 59.00
);

select lives_ok($$
    insert into public.reservations (
        id, organisation_id, customer_id, product_id, quantity,
        rental_start, rental_end, delivery_address_line_1,
        delivery_postcode, delivery_city, weekly_price_at_booking,
        deposit_amount, total_amount
    ) values (
        '00000000-0000-0000-0000-000000000133',
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000121', 'mm1c-product', 1,
        '2037-02-01 10:00:00+00', '2037-02-07 10:00:00+00',
        '3 MM1C Street', '16000', 'Angouleme', 59.00, 250.00, 59.00
    )
$$, 'existing reservation accepts NULL recipient snapshot');

select lives_ok($$
    update public.reservations
    set recipient_first_name = 'John',
        recipient_last_name = 'Smith',
        recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, 'complete recipient snapshot is accepted');

select throws_ok($$
    update public.reservations
    set recipient_first_name = 'John', recipient_last_name = null, recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'first-name-only recipient snapshot is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = null, recipient_last_name = 'Smith', recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'last-name-only recipient snapshot is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = null, recipient_last_name = null, recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'phone-only recipient snapshot is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = 'John', recipient_last_name = 'Smith', recipient_phone = null
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'name-only recipient snapshot is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = ' ', recipient_last_name = 'Smith', recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'blank recipient first name is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = 'John', recipient_last_name = ' ', recipient_phone = '0611223344'
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'blank recipient last name is rejected');

select throws_ok($$
    update public.reservations
    set recipient_first_name = 'John', recipient_last_name = 'Smith', recipient_phone = ' '
    where id = '00000000-0000-0000-0000-000000000131'
$$, '23514', null, 'blank recipient phone is rejected');

select is(
    (select first_name || ':' || last_name || ':' || email || ':' || phone
     from public.customers
     where id = '00000000-0000-0000-0000-000000000121'),
    'MM1C:Customer:mm1c-customer@example.com:0612345678',
    'recipient snapshot does not alter the customer row'
);

select lives_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000131', 'personal', 'MM1C Customer',
        'mm1c-customer@example.com', '1 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, 'personal billing snapshot succeeds');

select lives_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        company_name, billing_email, billing_address_line_1,
        billing_address_line_2, billing_postcode, billing_city,
        billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000134', 'business', 'Company ABC',
        'Company ABC', 'accounts@example.com', '2 Billing Street',
        'Suite 2', '16000', 'Angouleme', 'FR'
    )
$$, 'business billing snapshot with optional fields succeeds');

select lives_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000133', 'custom', 'Alternate Billing',
        'billing@example.com', '3 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, 'custom billing snapshot succeeds');

select throws_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000131', 'personal', 'Second Billing',
        'second@example.com', '4 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, '23505', null, 'second billing snapshot for one reservation is rejected');

select throws_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        '00000000-0000-0000-0000-000000000012',
        '00000000-0000-0000-0000-000000000132', 'business', 'Wrong Tenant',
        'wrong@example.com', '5 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, '23503', null, 'cross-organisation billing relationship is rejected');

select throws_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000199', 'personal', 'Missing Reservation',
        'missing@example.com', '6 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, '23503', null, 'invalid billing reservation is rejected');

select throws_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000133', 'invalid', 'Invalid Mode',
        'invalid@example.com', '7 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, '23514', null, 'invalid billing mode is rejected');

select throws_ok($$
    insert into public.reservation_billing_details (
        organisation_id, reservation_id, billing_mode, billing_name,
        billing_email, billing_address_line_1, billing_postcode,
        billing_city, billing_country
    ) values (
        (select id from public.organisations where slug = 'igloue'),
        '00000000-0000-0000-0000-000000000134', 'business', ' ',
        'blank@example.com', '8 Billing Street', '16000',
        'Angouleme', 'FR'
    )
$$, '23514', null, 'blank billing name is rejected');

select is(
    (select count(*)::integer from public.organisations where slug = 'mm1c-test-org'),
    1,
    'customer company test data did not create a SaaS organisation'
);

select is(
    (select count(*)::integer from public.reservation_items),
    0,
    'reservation items remain untouched by MM1C'
);

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name = 'delivery_address_line_1'
    ),
    'delivery address columns remain on reservations'
);

select * from finish();

rollback;

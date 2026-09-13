create extension if not exists btree_gist;

create table public.products (
    id text primary key,
    name text not null,
    tagline text,
    type text,
    tier text,
    cooling_capacity_kw numeric(4,2),
    max_room_size_m2 integer,
    weekly_price numeric(10,2) not null,
    deposit_amount numeric(10,2) not null default 0,
    installation_required boolean not null default false,
    service_area text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create table public.physical_machines (
    id text primary key,
    product_id text not null references public.products(id),
    serial_number text,
    status text not null default 'available',
    purchase_date date,
    purchase_cost numeric(10,2),
    current_location text,
    condition text,
    unavailable_until timestamptz,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create table public.customers (
    id uuid primary key default gen_random_uuid(),
    first_name text not null,
    last_name text not null,
    email text not null,
    phone text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create table public.reservations (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references public.customers(id),
    product_id text not null references public.products(id),
    quantity integer not null default 1,

    rental_start timestamptz not null,
    rental_end timestamptz not null,
    status text not null default 'pending',

    delivery_address_line_1 text not null,
    delivery_address_line_2 text,
    delivery_postcode text not null,
    delivery_city text not null,
    delivery_zone text,

    weekly_price_at_booking numeric(10,2) not null,
    delivery_fee numeric(10,2) not null default 0,
    options_total numeric(10,2) not null default 0,
    deposit_amount numeric(10,2) not null default 0,
    total_amount numeric(10,2) not null,

    payment_status text not null default 'not_started',

    customer_notes text,
    internal_notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint reservations_quantity_positive
        check (quantity > 0),

    constraint reservations_dates_valid
        check (rental_end > rental_start)
);
create table public.allocations (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null references public.reservations(id),
    machine_id text not null references public.physical_machines(id),

    status text not null default 'held'
    check (status in ('held', 'reserved', 'active', 'released', 'cancelled')),

    operational_start timestamptz not null,
    operational_end timestamptz not null,

    allocated_at timestamptz not null default now(),
    released_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint allocations_dates_valid
    check (operational_end > operational_start)
);

alter table public.allocations
add constraint allocations_no_machine_overlap
exclude using gist (
    machine_id with =,
    tstzrange(operational_start, operational_end, '[)') with &&
)
where (status in ('held', 'reserved', 'active'));

create table public.service_jobs (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null references public.reservations(id),

    job_type text not null,
    scheduled_date date not null,
    time_slot text,

    address_line_1 text not null,
    address_line_2 text,
    postcode text not null,
    city text not null,

    status text not null default 'scheduled',

    assigned_staff_id uuid,
    assigned_vehicle_id uuid,

    arrival_time timestamptz,
    completion_time timestamptz,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
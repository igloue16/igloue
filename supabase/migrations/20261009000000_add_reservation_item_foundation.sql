-- Structural foundation for multiple rental units per reservation.
-- Existing reservation creation and allocation behavior remains unchanged.

create table public.reservation_items (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    reservation_id uuid not null,
    product_id text not null,
    unit_rental_price numeric(10,2) not null,
    line_total numeric(10,2) not null,
    created_at timestamptz not null default now(),

    constraint reservation_items_unit_rental_price_non_negative
        check (unit_rental_price >= 0),

    constraint reservation_items_line_total_non_negative
        check (line_total >= 0),

    constraint reservation_items_id_reservation_unique
        unique (id, reservation_id),

    constraint reservation_items_reservation_organisation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations (id, organisation_id),

    constraint reservation_items_product_fkey
        foreign key (product_id)
        references public.products (id)
);

alter table public.reservations
    add constraint reservations_id_organisation_unique
    unique (id, organisation_id);

alter table public.allocations
    add column reservation_item_id uuid;

alter table public.allocations
    add constraint allocations_reservation_item_reservation_fkey
    foreign key (reservation_item_id, reservation_id)
    references public.reservation_items (id, reservation_id);

create unique index allocations_one_item_one_allocation_uidx
    on public.allocations (reservation_item_id)
    where reservation_item_id is not null;

create index reservation_items_reservation_id_idx
    on public.reservation_items (reservation_id);

alter table public.reservation_items enable row level security;

revoke all on table public.reservation_items from public;
revoke all on table public.reservation_items from anon, authenticated;
grant select, insert on table public.reservation_items to service_role;

-- A1.1: staff membership and tenant-safe catalog, fleet, and allocation ownership.

create table public.organisation_members (
    organisation_id uuid not null,
    user_id uuid not null,
    role text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint organisation_members_pkey
        primary key (user_id, organisation_id),
    constraint organisation_members_organisation_fkey
        foreign key (organisation_id)
        references public.organisations(id)
        on delete cascade,
    constraint organisation_members_user_fkey
        foreign key (user_id)
        references auth.users(id)
        on delete cascade,
    constraint organisation_members_role_check
        check (role in ('owner', 'admin', 'staff'))
);

create index organisation_members_organisation_id_idx
    on public.organisation_members (organisation_id);

create trigger organisation_members_set_updated_at
before update on public.organisation_members
for each row execute function public.set_updated_at();

alter table public.organisation_members enable row level security;
revoke all privileges on table public.organisation_members
    from public, anon, authenticated, service_role;
grant select on table public.organisation_members to authenticated;
grant select, insert, update, delete on table public.organisation_members
    to service_role;

create policy organisation_members_select_self
    on public.organisation_members
    for select
    to authenticated
    using (user_id = (select auth.uid()));

create function public.has_active_organisation_membership(
    p_organisation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select auth.uid() is not null
       and exists (
            select 1
            from public.organisation_members as m
            where m.organisation_id = p_organisation_id
              and m.user_id = auth.uid()
              and m.active
       );
$$;

revoke all on function public.has_active_organisation_membership(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.has_active_organisation_membership(uuid)
    to authenticated;

-- Existing IGLOUE catalog rows are the only legacy tenantless catalog rows.
-- Resolve by stable slug; fail rather than selecting an arbitrary organisation.
alter table public.products
    add column organisation_id uuid;

do $$
declare
    v_igloue_organisation_id uuid;
begin
    select o.id
    into v_igloue_organisation_id
    from public.organisations as o
    where o.slug = 'igloue';

    if v_igloue_organisation_id is null then
        raise exception 'Cannot assign legacy products: IGLOUE organisation is missing';
    end if;

    update public.products as p
    set organisation_id = v_igloue_organisation_id
    where p.organisation_id is null;

    if exists (
        select 1 from public.products as p
        where p.organisation_id is null
    ) then
        raise exception 'Cannot assign tenant ownership to every product';
    end if;
end;
$$;

alter table public.products
    add constraint products_organisation_fkey
        foreign key (organisation_id)
        references public.organisations(id),
    alter column organisation_id set not null,
    add constraint products_id_organisation_id_key
        unique (id, organisation_id);

alter table public.physical_machines
    add column organisation_id uuid;

update public.physical_machines as m
set organisation_id = p.organisation_id
from public.products as p
where p.id = m.product_id
  and m.organisation_id is null;

do $$
begin
    if exists (
        select 1
        from public.physical_machines as m
        left join public.products as p on p.id = m.product_id
        where m.organisation_id is null
           or p.id is null
           or m.organisation_id is distinct from p.organisation_id
    ) then
        raise exception 'Cannot safely assign physical-machine tenant ownership';
    end if;
end;
$$;

alter table public.physical_machines
    drop constraint physical_machines_product_id_fkey,
    add constraint physical_machines_organisation_fkey
        foreign key (organisation_id)
        references public.organisations(id),
    alter column organisation_id set not null,
    add constraint physical_machines_id_organisation_id_key
        unique (id, organisation_id),
    add constraint physical_machines_product_organisation_fkey
        foreign key (product_id, organisation_id)
        references public.products(id, organisation_id);

-- Retain globally unique product IDs while enforcing tenant agreement.
alter table public.reservations
    drop constraint reservations_product_id_fkey,
    add constraint reservations_product_organisation_fkey
        foreign key (product_id, organisation_id)
        references public.products(id, organisation_id);

alter table public.reservation_items
    drop constraint reservation_items_product_fkey,
    add constraint reservation_items_product_organisation_fkey
        foreign key (product_id, organisation_id)
        references public.products(id, organisation_id);

-- Allocations link both a reservation and a machine, so persist and enforce
-- their common tenant. Existing trusted writers may omit the new column; the
-- trigger below derives it from the reservation and validates the machine.
alter table public.allocations
    add column organisation_id uuid;

do $$
begin
    if exists (
        select 1
        from public.allocations as a
        left join public.reservations as r on r.id = a.reservation_id
        left join public.organisations as o on o.id = r.organisation_id
        left join public.physical_machines as m on m.id = a.machine_id
        where r.id is null
           or r.organisation_id is null
           or o.id is null
           or m.id is null
           or m.organisation_id is distinct from r.organisation_id
    ) then
        raise exception 'Cannot safely assign allocation tenant ownership';
    end if;

    update public.allocations as a
    set organisation_id = r.organisation_id
    from public.reservations as r
    where r.id = a.reservation_id
      and a.organisation_id is null;

    if exists (
        select 1 from public.allocations as a
        where a.organisation_id is null
    ) then
        raise exception 'Cannot assign tenant ownership to every allocation';
    end if;
end;
$$;

alter table public.allocations
    drop constraint allocations_reservation_id_fkey,
    drop constraint allocations_machine_id_fkey,
    add constraint allocations_organisation_fkey
        foreign key (organisation_id)
        references public.organisations(id),
    alter column organisation_id set not null,
    add constraint allocations_reservation_organisation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations(id, organisation_id),
    add constraint allocations_machine_organisation_fkey
        foreign key (machine_id, organisation_id)
        references public.physical_machines(id, organisation_id);

create function public.derive_allocation_organisation_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reservation_organisation_id uuid;
    v_machine_organisation_id uuid;
begin
    select r.organisation_id
    into v_reservation_organisation_id
    from public.reservations as r
    where r.id = new.reservation_id;

    if v_reservation_organisation_id is null then
        raise exception 'Allocation reservation has no organisation'
            using errcode = '23503';
    end if;

    select m.organisation_id
    into v_machine_organisation_id
    from public.physical_machines as m
    where m.id = new.machine_id;

    if v_machine_organisation_id is null
       or v_machine_organisation_id is distinct from v_reservation_organisation_id then
        raise exception 'Allocation reservation and machine organisations differ'
            using errcode = '23514';
    end if;

    if new.organisation_id is not null
       and new.organisation_id is distinct from v_reservation_organisation_id then
        raise exception 'Allocation organisation differs from its reservation'
            using errcode = '23514';
    end if;

    new.organisation_id := v_reservation_organisation_id;
    return new;
end;
$$;

revoke all on function public.derive_allocation_organisation_id()
    from public, anon, authenticated, service_role;

create trigger allocations_derive_organisation_id
before insert or update of reservation_id, machine_id, organisation_id
on public.allocations
for each row execute function public.derive_allocation_organisation_id();

-- Preserve the existing machine-seeding call shape while deriving ownership
-- only from the already tenant-owned product (never from a global default).
create function public.derive_machine_organisation_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_product_organisation_id uuid;
begin
    select p.organisation_id
    into v_product_organisation_id
    from public.products as p
    where p.id = new.product_id;

    if v_product_organisation_id is null then
        raise exception 'Physical-machine product has no organisation'
            using errcode = '23503';
    end if;

    if new.organisation_id is not null
       and new.organisation_id is distinct from v_product_organisation_id then
        raise exception 'Physical-machine and product organisations differ'
            using errcode = '23514';
    end if;

    new.organisation_id := v_product_organisation_id;
    return new;
end;
$$;

revoke all on function public.derive_machine_organisation_id()
    from public, anon, authenticated, service_role;

create trigger physical_machines_derive_organisation_id
before insert or update of product_id, organisation_id
on public.physical_machines
for each row execute function public.derive_machine_organisation_id();

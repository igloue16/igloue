-- Enforce same-organisation ownership for reservations and customers.
-- Existing NULL reservation ownership is deterministically derived from the
-- authoritative customer row; non-NULL inconsistencies fail the migration.

do $$
begin
    if exists (
        select 1
        from public.reservations as r
        left join public.customers as c on c.id = r.customer_id
        left join public.organisations as o on o.id = c.organisation_id
        where c.id is null
           or c.organisation_id is null
           or o.id is null
    ) then
        raise exception
            'Cannot enforce reservation/customer organisation ownership: referenced ownership is missing';
    end if;

    if exists (
        select 1
        from public.reservations as r
        join public.customers as c on c.id = r.customer_id
        where r.organisation_id is not null
          and r.organisation_id <> c.organisation_id
    ) then
        raise exception
            'Cannot enforce reservation/customer organisation ownership: existing organisation mismatch';
    end if;

    update public.reservations as r
    set organisation_id = c.organisation_id
    from public.customers as c
    where c.id = r.customer_id
      and r.organisation_id is null;
end;
$$;

alter table public.customers
    add constraint customers_id_organisation_id_key
    unique (id, organisation_id);

alter table public.reservations
    add constraint reservations_customer_organisation_fkey
    foreign key (customer_id, organisation_id)
    references public.customers (id, organisation_id);

-- Enforce organisation ownership for every reservation.
-- Repair only deterministic NULL ownership before applying NOT NULL;
-- non-NULL inconsistencies always abort the migration.

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
            'Cannot enforce reservation organisation ownership: referenced customer organisation is missing';
    end if;

    if exists (
        select 1
        from public.reservations as r
        join public.customers as c on c.id = r.customer_id
        where r.organisation_id is not null
          and r.organisation_id <> c.organisation_id
    ) then
        raise exception
            'Cannot enforce reservation organisation ownership: existing organisation mismatch';
    end if;

    update public.reservations as r
    set organisation_id = c.organisation_id
    from public.customers as c
    where c.id = r.customer_id
      and r.organisation_id is null;

    if exists (
        select 1
        from public.reservations
        where organisation_id is null
    ) then
        raise exception
            'Cannot enforce reservation organisation ownership: NULL ownership remains after backfill';
    end if;
end;
$$;

alter table public.reservations
    alter column organisation_id set not null;

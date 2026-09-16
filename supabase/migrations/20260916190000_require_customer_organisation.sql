-- Enforce organisation ownership for every customer row.
-- Repair any legacy NULLs first, failing safely if the IGLOUE organisation
-- cannot be resolved.

do $$
declare
    v_organisation_id uuid;
begin
    if exists (
        select 1
        from public.customers
        where organisation_id is null
    ) then
        select id
        into v_organisation_id
        from public.organisations
        where slug = 'igloue';

        if v_organisation_id is null then
            raise exception
                'Cannot enforce customer organisation ownership: IGLOUE organisation not found';
        end if;

        update public.customers
        set organisation_id = v_organisation_id
        where organisation_id is null;
    end if;
end;
$$;

alter table public.customers
    alter column organisation_id set not null;

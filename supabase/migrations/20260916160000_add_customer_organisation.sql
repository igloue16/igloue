-- Associate existing customers with the IGLOUE organisation.
--
-- organisation_id intentionally remains nullable while the reservation
-- transaction is still organisation-unaware.

alter table public.customers
    add column organisation_id uuid
        references public.organisations(id);

update public.customers as c
set organisation_id = o.id
from public.organisations as o
where o.slug = 'igloue';

create index customers_organisation_id_idx
    on public.customers (organisation_id);

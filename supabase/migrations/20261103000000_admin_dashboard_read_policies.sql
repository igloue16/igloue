-- A1.2: authenticated, read-only tenant access for the admin dashboard.

-- Existing browser grants included broad mutation privileges on several
-- business tables. Replace them with SELECT-only access for authenticated
-- members; trusted service-role grants remain unchanged.
revoke all privileges on table
    public.organisations,
    public.organisation_members,
    public.reservations,
    public.customers,
    public.reservation_items,
    public.products,
    public.physical_machines,
    public.allocations,
    public.service_jobs
from public, anon, authenticated;

grant select on table
    public.organisations,
    public.organisation_members,
    public.reservations,
    public.customers,
    public.reservation_items,
    public.products,
    public.physical_machines,
    public.allocations,
    public.service_jobs
to authenticated;

create policy organisations_select_active_member
    on public.organisations
    for select
    to authenticated
    using (public.has_active_organisation_membership(id));

create policy reservations_select_active_member
    on public.reservations
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

create policy customers_select_active_member
    on public.customers
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

create policy reservation_items_select_active_member
    on public.reservation_items
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

create policy products_select_active_member
    on public.products
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

create policy physical_machines_select_active_member
    on public.physical_machines
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

create policy allocations_select_active_member
    on public.allocations
    for select
    to authenticated
    using (public.has_active_organisation_membership(organisation_id));

-- service_jobs has no duplicate organisation_id. Its reservation lookup uses
-- the reservation PK and the same active-membership helper as other tables.
create policy service_jobs_select_active_member
    on public.service_jobs
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.reservations as r
            where r.id = service_jobs.reservation_id
              and public.has_active_organisation_membership(r.organisation_id)
        )
    );

-- Existing indexes cover organisation_members(user_id, organisation_id),
-- customers(organisation_id), and reservations(organisation_id). Add indexes
-- for tenant-filtered catalog/fleet/item queries and service-job reservation
-- lookups used by the policy above.
create index products_organisation_id_idx
    on public.products (organisation_id);

create index physical_machines_organisation_id_idx
    on public.physical_machines (organisation_id);

create index reservation_items_organisation_id_idx
    on public.reservation_items (organisation_id);

create index allocations_organisation_id_idx
    on public.allocations (organisation_id);

create index service_jobs_reservation_id_idx
    on public.service_jobs (reservation_id);

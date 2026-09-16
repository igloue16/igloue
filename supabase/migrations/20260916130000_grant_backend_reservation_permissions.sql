-- Allow the trusted IGLOUE backend service role to execute
-- the reservation transaction while keeping browser roles locked down.

grant select on table public.products
to service_role;

grant insert on table public.customers
to service_role;

grant select, insert on table public.reservations
to service_role;

grant select, insert on table public.service_jobs
to service_role;
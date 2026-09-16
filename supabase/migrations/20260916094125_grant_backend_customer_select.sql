-- Allow the trusted IGLOUE backend service role to read
-- customer IDs returned during reservation creation.

grant select on table public.customers
to service_role;
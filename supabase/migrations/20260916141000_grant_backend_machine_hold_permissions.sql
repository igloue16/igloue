-- Allow only the trusted IGLOUE backend service role to execute
-- the physical-machine hold workflow.
--
-- Browser-facing roles must not be able to manipulate fleet
-- allocations or invoke the machine-hold function directly.

-- Remove backend-only privileges from browser-facing roles.

revoke update on table public.reservations
from anon, authenticated;

revoke select, update on table public.physical_machines
from anon, authenticated;

revoke select, insert on table public.allocations
from anon, authenticated;

revoke execute on function public.create_machine_hold(
    uuid,
    timestamptz,
    timestamptz
)
from anon, authenticated;

-- Grant the trusted backend the permissions required by
-- create_machine_hold.
--
-- UPDATE is required on reservations and physical_machines because
-- the function uses SELECT ... FOR UPDATE row locking.

grant select, update on table public.reservations
to service_role;

grant select, update on table public.physical_machines
to service_role;

grant select, insert on table public.allocations
to service_role;

grant execute on function public.create_machine_hold(
    uuid,
    timestamptz,
    timestamptz
)
to service_role;
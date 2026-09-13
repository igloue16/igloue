-- IGLOUE V1 security hardening
-- Keep database tables inaccessible to browser clients unless
-- explicit access policies are deliberately added later.

alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.physical_machines enable row level security;
alter table public.reservations enable row level security;
alter table public.allocations enable row level security;
alter table public.service_jobs enable row level security;-- Constrain core V1 status fields to known values.

alter table public.physical_machines
add constraint physical_machines_status_check
check (
  status in (
    'available',
    'reserved',
    'allocated',
    'rented',
    'returned',
    'inspection',
    'cleaning',
    'maintenance',
    'retired'
  )
);

alter table public.reservations
add constraint reservations_status_check
check (
  status in (
    'pending',
    'confirmed',
    'ongoing',
    'completed',
    'cancelled'
  )
);

alter table public.service_jobs
add constraint service_jobs_job_type_check
check (
  job_type in ('delivery', 'collection')
);

alter table public.service_jobs
add constraint service_jobs_status_check
check (
  status in (
    'scheduled',
    'assigned',
    'in_progress',
    'completed',
    'failed',
    'cancelled'
  )
);
-- Prevent duplicate serial numbers for physical machines.
-- PostgreSQL still allows multiple NULL values, which is useful
-- while a machine's serial number has not yet been recorded.

alter table public.physical_machines
add constraint physical_machines_serial_number_unique
unique (serial_number);
-- Automatically maintain updated_at timestamps.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger physical_machines_set_updated_at
before update on public.physical_machines
for each row execute function public.set_updated_at();

create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function public.set_updated_at();

create trigger allocations_set_updated_at
before update on public.allocations
for each row execute function public.set_updated_at();

create trigger service_jobs_set_updated_at
before update on public.service_jobs
for each row execute function public.set_updated_at();
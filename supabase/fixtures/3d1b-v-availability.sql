-- Local development fixture for the 3D1B customer-flow walkthrough.
--
-- This file is intentionally outside supabase/migrations and is never loaded
-- by a hosted deployment. Load it explicitly against a local Supabase
-- database only. Re-running it keeps the single fixture machine idempotent.

insert into public.physical_machines (
    id,
    product_id,
    serial_number,
    status,
    active,
    unavailable_until,
    current_location,
    condition
)
values (
    'LOCAL-DEV-E01',
    'essential',
    'LOCAL-DEV-E01',
    'available',
    true,
    null,
    'local-development',
    'test-fixture'
)
on conflict (id) do update
set
    product_id = excluded.product_id,
    serial_number = excluded.serial_number,
    status = excluded.status,
    active = excluded.active,
    unavailable_until = excluded.unavailable_until,
    current_location = excluded.current_location,
    condition = excluded.condition;

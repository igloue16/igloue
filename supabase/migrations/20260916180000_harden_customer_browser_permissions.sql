-- Keep customer records behind the trusted backend and RLS policies.
-- Browser roles must not access the table directly.

revoke all privileges on table public.customers from anon, authenticated;

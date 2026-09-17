-- Reproducible Supabase Cron job for expired reservation holds.
-- The migration role (postgres) owns the backend cleanup function and runs
-- this command with its database privileges; browser grants remain unchanged.

create extension if not exists pg_cron;

select cron.schedule(
    'igloue-expired-hold-cleanup',
    '*/5 * * * *',
    $$select public.cleanup_expired_reservation_holds(100);$$
);


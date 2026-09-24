-- Durable proof that P3D3 authoritative matching completed successfully.
-- This marker is evidence of matching only; it is not payment authority.

alter table public.payment_provider_events
    add column matched_at timestamptz;

-- The constraint is deliberately NOT VALID so legacy linked rows are not
-- rewritten or fabricated. P3E must require a non-null marker and therefore
-- will fail closed for any legacy relationship without proven match history.
alter table public.payment_provider_events
    add constraint payment_provider_events_match_marker_consistency_check
    check (
        matched_at is null
        or (payment_attempt_id is not null and organisation_id is not null)
    ) not valid;

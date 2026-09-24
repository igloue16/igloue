-- Extend provider-event storage into a receipt-compatible ledger.
-- Existing rows remain valid and newly received events may be unmatched.

alter table public.payment_provider_events
    alter column organisation_id drop not null,
    alter column payment_attempt_id drop not null,
    add column provider_event_created_at timestamptz,
    add column livemode boolean,
    add column payload_sha256 text,
    add column conflict_detected_at timestamptz,
    add column last_error_code text;

alter table public.payment_provider_events
    add constraint payment_provider_events_relationship_pair_check
    check (
        (organisation_id is null and payment_attempt_id is null)
        or (organisation_id is not null and payment_attempt_id is not null)
    ),
    add constraint payment_provider_events_payload_sha256_check
    check (
        payload_sha256 is null
        or payload_sha256 ~ '^[0-9a-f]{64}$'
    ),
    add constraint payment_provider_events_last_error_code_check
    check (
        last_error_code is null
        or (
            length(last_error_code) between 1 and 64
            and last_error_code = trim(last_error_code)
            and last_error_code ~ '^[a-z0-9_]+$'
        )
    );

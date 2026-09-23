-- Transactional business-event outbox foundation.
-- Payloads must not contain provider credentials or rendered email bodies.
-- Downstream delivery failures must never alter authoritative business state.

create table public.outbox_events (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    event_type text not null,
    aggregate_type text not null,
    aggregate_id uuid not null,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempt_count integer not null default 0,
    available_at timestamptz not null default now(),
    last_attempt_at timestamptz,
    processed_at timestamptz,
    last_error_code text,
    created_at timestamptz not null default now(),

    constraint outbox_events_event_type_not_blank
        check (length(trim(event_type)) > 0 and event_type = trim(event_type)),
    constraint outbox_events_aggregate_type_not_blank
        check (length(trim(aggregate_type)) > 0 and aggregate_type = trim(aggregate_type)),
    constraint outbox_events_status_check
        check (status in ('pending', 'processing', 'failed', 'completed')),
    constraint outbox_events_attempt_count_check
        check (attempt_count >= 0),
    constraint outbox_events_processed_consistency_check
        check ((status = 'completed') = (processed_at is not null)),
    constraint outbox_events_logical_occurrence_unique
        unique (organisation_id, event_type, aggregate_type, aggregate_id)
);

-- Supports future workers claiming pending/failed events that are available.
create index outbox_events_claim_idx
    on public.outbox_events (status, available_at);

alter table public.outbox_events enable row level security;

revoke all privileges on table public.outbox_events from public;
revoke all privileges on table public.outbox_events from anon, authenticated;
revoke all privileges on table public.outbox_events from service_role;
grant select, insert, update on table public.outbox_events to service_role;

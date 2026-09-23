-- Payment foundation only: durable attempt and provider-event boundaries.
-- No provider credentials, customer PII, card data, or raw webhook payloads.

alter table public.reservations
    add constraint reservations_payment_status_check
    check (payment_status in (
        'not_started', 'processing', 'paid', 'failed', 'requires_review', 'refunded'
    ));

create table public.payment_attempts (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    reservation_id uuid not null,
    provider text not null,
    purpose text not null,
    amount numeric(10,2) not null,
    currency text not null,
    status text not null,
    idempotency_key text not null,
    provider_checkout_session_id text,
    provider_payment_intent_id text,
    paid_at timestamptz,
    refunded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint payment_attempts_reservation_organisation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations(id, organisation_id),
    constraint payment_attempts_identity_unique
        unique (id, organisation_id),
    constraint payment_attempts_provider_check
        check (provider = 'stripe'),
    constraint payment_attempts_purpose_check
        check (purpose = 'rental'),
    constraint payment_attempts_amount_check
        check (amount >= 0),
    constraint payment_attempts_currency_check
        check (currency = 'EUR'),
    constraint payment_attempts_status_check
        check (status in ('created', 'checkout_open', 'paid', 'failed', 'requires_review', 'refunded')),
    constraint payment_attempts_idempotency_key_check
        check (length(trim(idempotency_key)) between 1 and 255 and idempotency_key = trim(idempotency_key)),
    constraint payment_attempts_paid_consistency_check
        check (
            (status = 'paid' and paid_at is not null)
            or (status <> 'paid')
        ),
    constraint payment_attempts_refunded_consistency_check
        check (
            (status = 'refunded' and paid_at is not null and refunded_at is not null)
            or (status <> 'refunded' and refunded_at is null)
        ),
    constraint payment_attempts_paid_at_state_check
        check (paid_at is null or status in ('paid', 'requires_review', 'refunded'))
);

create unique index payment_attempts_idempotency_idx
    on public.payment_attempts (organisation_id, reservation_id, purpose, idempotency_key);

create unique index payment_attempts_checkout_session_idx
    on public.payment_attempts (provider, provider_checkout_session_id)
    where provider_checkout_session_id is not null;

create unique index payment_attempts_payment_intent_idx
    on public.payment_attempts (provider, provider_payment_intent_id)
    where provider_payment_intent_id is not null;

create unique index payment_attempts_one_paid_rental_idx
    on public.payment_attempts (organisation_id, reservation_id, purpose)
    where status = 'paid';

create index payment_attempts_reservation_idx
    on public.payment_attempts (organisation_id, reservation_id);

create index payment_attempts_status_idx
    on public.payment_attempts (organisation_id, status, created_at);

create table public.payment_provider_events (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references public.organisations(id),
    payment_attempt_id uuid not null,
    provider text not null,
    provider_event_id text not null,
    event_type text not null,
    status text not null default 'received',
    created_at timestamptz not null default now(),
    processed_at timestamptz,

    constraint payment_provider_events_attempt_organisation_fkey
        foreign key (payment_attempt_id, organisation_id)
        references public.payment_attempts(id, organisation_id),
    constraint payment_provider_events_provider_check
        check (provider = 'stripe'),
    constraint payment_provider_events_event_id_check
        check (length(trim(provider_event_id)) between 1 and 255 and provider_event_id = trim(provider_event_id)),
    constraint payment_provider_events_type_check
        check (length(trim(event_type)) between 1 and 255 and event_type = trim(event_type)),
    constraint payment_provider_events_status_check
        check (status in ('received', 'processed', 'ignored', 'failed')),
    constraint payment_provider_events_processed_consistency_check
        check ((status = 'processed') = (processed_at is not null))
);

create unique index payment_provider_events_provider_event_idx
    on public.payment_provider_events (provider, provider_event_id);

create index payment_provider_events_attempt_idx
    on public.payment_provider_events (organisation_id, payment_attempt_id, created_at);

alter table public.payment_attempts enable row level security;
alter table public.payment_provider_events enable row level security;

revoke all privileges on table public.payment_attempts from public;
revoke all privileges on table public.payment_attempts from anon, authenticated, service_role;
grant select, insert, update on table public.payment_attempts to service_role;

revoke all privileges on table public.payment_provider_events from public;
revoke all privileges on table public.payment_provider_events from anon, authenticated, service_role;
grant select, insert, update on table public.payment_provider_events to service_role;

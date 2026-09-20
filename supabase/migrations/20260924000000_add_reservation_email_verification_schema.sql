-- 3D3-B: reservation email-verification schema foundation.
-- Token issuance, hashing, delivery and consumption are deliberately deferred.

alter table public.reservations
    add column email_verification_status text not null default 'pending',
    add column email_verified_at timestamptz;

alter table public.reservations
    add constraint reservations_email_verification_status_check
    check (email_verification_status in ('pending', 'verified', 'revoked'));

alter table public.reservations
    add constraint reservations_email_verification_timestamp_check
    check (
        (email_verification_status = 'verified' and email_verified_at is not null)
        or (email_verification_status in ('pending', 'revoked') and email_verified_at is null)
    );

-- Composite keys allow the token row to carry and enforce tenant ownership.
alter table public.reservations
    add constraint reservations_id_organisation_id_key
    unique (id, organisation_id),
    add constraint reservations_id_organisation_customer_key
    unique (id, organisation_id, customer_id);

create table public.reservation_security_tokens (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    reservation_id uuid not null,
    customer_id uuid not null,
    purpose text not null,
    token_hash bytea not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    revoked_at timestamptz,
    superseded_by uuid,

    constraint reservation_security_tokens_purpose_check
        check (purpose in ('email_verification')),
    constraint reservation_security_tokens_hash_not_empty
        check (octet_length(token_hash) > 0),
    constraint reservation_security_tokens_expiry_check
        check (expires_at > created_at),
    constraint reservation_security_tokens_consumed_at_check
        check (consumed_at is null or consumed_at >= created_at),
    constraint reservation_security_tokens_revoked_at_check
        check (revoked_at is null or revoked_at >= created_at),
    constraint reservation_security_tokens_terminal_state_check
        check (not (consumed_at is not null and revoked_at is not null)),
    constraint reservation_security_tokens_not_self_superseded
        check (superseded_by is null or superseded_by <> id),

    constraint reservation_security_tokens_organisation_fkey
        foreign key (organisation_id)
        references public.organisations(id),
    constraint reservation_security_tokens_reservation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations(id, organisation_id),
    constraint reservation_security_tokens_customer_fkey
        foreign key (customer_id, organisation_id)
        references public.customers(id, organisation_id),
    constraint reservation_security_tokens_reservation_customer_fkey
        foreign key (reservation_id, organisation_id, customer_id)
        references public.reservations(id, organisation_id, customer_id),
    constraint reservation_security_tokens_superseded_by_fkey
        foreign key (superseded_by)
        references public.reservation_security_tokens(id)
);

create index reservation_security_tokens_hash_purpose_idx
    on public.reservation_security_tokens (token_hash, purpose);

create index reservation_security_tokens_reservation_purpose_idx
    on public.reservation_security_tokens (reservation_id, purpose);

create index reservation_security_tokens_expiry_idx
    on public.reservation_security_tokens (expires_at);

create index reservation_security_tokens_organisation_idx
    on public.reservation_security_tokens (organisation_id);

-- Expiry is time-dependent and intentionally not part of this uniqueness rule.
-- A future resend operation must revoke/supersede an old token before issuing
-- its replacement, including when the old token has expired.
create unique index reservation_security_tokens_one_active_email_idx
    on public.reservation_security_tokens (reservation_id, purpose)
    where consumed_at is null
      and revoked_at is null
      and superseded_by is null;

alter table public.reservation_security_tokens enable row level security;

revoke all privileges on table public.reservation_security_tokens from public;
revoke all privileges on table public.reservation_security_tokens from anon, authenticated;
grant select, insert, update, delete on table public.reservation_security_tokens to service_role;

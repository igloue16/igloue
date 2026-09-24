-- Structural reservation-context snapshots for recipient and billing identity.
-- Existing reservation creation remains unchanged and does not populate them.

alter table public.reservations
    add column recipient_first_name text,
    add column recipient_last_name text,
    add column recipient_phone text;

alter table public.reservations
    add constraint reservations_recipient_snapshot_check
    check (
        (
            recipient_first_name is null
            and recipient_last_name is null
            and recipient_phone is null
        )
        or (
            recipient_first_name is not null
            and recipient_last_name is not null
            and recipient_phone is not null
            and length(trim(recipient_first_name)) between 1 and 100
            and length(trim(recipient_last_name)) between 1 and 100
            and length(trim(recipient_phone)) between 1 and 32
        )
    );

create table public.reservation_billing_details (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    reservation_id uuid not null,
    billing_mode text not null,
    billing_name text not null,
    company_name text,
    billing_email text not null,
    billing_address_line_1 text not null,
    billing_address_line_2 text,
    billing_postcode text not null,
    billing_city text not null,
    billing_country text not null,
    created_at timestamptz not null default now(),

    constraint reservation_billing_details_mode_check
        check (billing_mode in ('personal', 'business', 'custom')),

    constraint reservation_billing_details_name_check
        check (length(trim(billing_name)) between 1 and 100),

    constraint reservation_billing_details_email_check
        check (length(trim(billing_email)) between 1 and 254),

    constraint reservation_billing_details_address_check
        check (length(trim(billing_address_line_1)) between 1 and 200),

    constraint reservation_billing_details_postcode_check
        check (length(trim(billing_postcode)) between 1 and 32),

    constraint reservation_billing_details_city_check
        check (length(trim(billing_city)) between 1 and 100),

    constraint reservation_billing_details_country_check
        check (length(trim(billing_country)) between 1 and 100),

    constraint reservation_billing_details_reservation_organisation_fkey
        foreign key (reservation_id, organisation_id)
        references public.reservations (id, organisation_id),

    constraint reservation_billing_details_reservation_unique
        unique (reservation_id)
);

alter table public.reservation_billing_details enable row level security;

revoke all on table public.reservation_billing_details from public;
revoke all on table public.reservation_billing_details from anon, authenticated, service_role;
grant select, insert on table public.reservation_billing_details to service_role;

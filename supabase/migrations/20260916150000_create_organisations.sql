-- Establish the organisation root for future multi-tenant work.
--
-- Existing business tables remain unchanged in Batch 1.  RLS is enabled
-- without policies so browser roles retain the current deny-by-default
-- posture until tenant membership and access rules are introduced.

create table public.organisations (
    id uuid primary key default gen_random_uuid(),
    slug text not null,
    name text not null,
    legal_name text,
    status text not null default 'active',
    default_currency text not null default 'EUR',
    timezone text not null default 'Europe/Paris',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint organisations_slug_not_blank
        check (length(trim(slug)) > 0),
    constraint organisations_slug_format
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    constraint organisations_status_check
        check (status in ('active', 'suspended', 'archived')),
    constraint organisations_currency_check
        check (default_currency ~ '^[A-Z]{3}$'),
    constraint organisations_timezone_not_blank
        check (length(trim(timezone)) > 0),
    constraint organisations_slug_unique
        unique (slug)
);

revoke all privileges on table public.organisations from anon, authenticated;

alter table public.organisations enable row level security;

create trigger organisations_set_updated_at
before update on public.organisations
for each row execute function public.set_updated_at();

-- Bootstrap the existing IGLOUE.fr business exactly once.  ON CONFLICT
-- preserves any later edits to the organisation record on re-application.
insert into public.organisations (
    slug,
    name,
    legal_name,
    status,
    default_currency,
    timezone
)
values (
    'igloue',
    'IGLOUE',
    null,
    'active',
    'EUR',
    'Europe/Paris'
)
on conflict (slug) do nothing;

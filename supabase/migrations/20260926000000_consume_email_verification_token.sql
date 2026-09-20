-- 3D3-D: consume an email-verification digest atomically. No raw token reaches SQL.
-- A digest must identify at most one credential, even across future purposes.
create unique index reservation_security_tokens_hash_unique_idx
    on public.reservation_security_tokens (token_hash);

create function public.consume_email_verification_token(p_token_hash bytea)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_token_id uuid;
    v_reservation_id uuid;
    v_token public.reservation_security_tokens%rowtype;
    v_reservation public.reservations%rowtype;
    v_hold_expires_at timestamptz;
    v_checked_at timestamptz;
begin
    if p_token_hash is null or pg_catalog.octet_length(p_token_hash) <> 32 then
        raise exception 'Email verification credential is unavailable'
            using errcode = 'P0001';
    end if;

    -- Find an identifier without taking the token lock: issuance holds the
    -- reservation before the token, as do the hold lifecycle functions.
    select t.id, t.reservation_id into v_token_id, v_reservation_id
    from public.reservation_security_tokens as t
    where t.token_hash = p_token_hash
      and t.purpose = 'email_verification';

    if v_token_id is null then
        raise exception 'Email verification credential is unavailable'
            using errcode = 'P0001';
    end if;

    select * into v_reservation
    from public.reservations as r
    where r.id = v_reservation_id
    for update;

    if not found then
        raise exception 'Email verification credential is unavailable'
            using errcode = 'P0001';
    end if;

    -- Lock allocation before token, matching issue_email_verification_token.
    -- If cleanup won the reservation lock, the status/hold check below fails.
    select a.hold_expires_at into v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = v_reservation_id and a.status = 'held'
    order by a.created_at
    limit 1 for update;

    select * into v_token
    from public.reservation_security_tokens as t
    where t.id = v_token_id
      and t.token_hash = p_token_hash
      and t.purpose = 'email_verification'
    for update;

    -- Use wall-clock time AFTER waiting for locks, not transaction-start now().
    v_checked_at := pg_catalog.clock_timestamp();

    if not found
       or v_token.consumed_at is not null
       or v_token.revoked_at is not null
       or v_token.superseded_by is not null
       or v_token.expires_at <= v_checked_at
       or v_reservation.status <> 'pending'
       or v_reservation.email_verification_status <> 'pending'
       or v_reservation.email_verified_at is not null
       or v_token.reservation_id <> v_reservation.id
       or v_token.customer_id <> v_reservation.customer_id
       or v_token.organisation_id <> v_reservation.organisation_id
       or not exists (
           select 1 from public.customers as c
           where c.id = v_reservation.customer_id
             and c.organisation_id = v_reservation.organisation_id
       )
       or v_hold_expires_at is null
       or v_hold_expires_at <= v_checked_at then
        raise exception 'Email verification credential is unavailable'
            using errcode = 'P0001';
    end if;

    update public.reservation_security_tokens
    set consumed_at = v_checked_at
    where id = v_token.id;

    update public.reservations
    set email_verification_status = 'verified',
        email_verified_at = v_checked_at
    where id = v_reservation.id;

    return true;
end;
$$;

revoke all on function public.consume_email_verification_token(bytea) from public;
revoke all on function public.consume_email_verification_token(bytea) from anon, authenticated;
grant execute on function public.consume_email_verification_token(bytea) to service_role;

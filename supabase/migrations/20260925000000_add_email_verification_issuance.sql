-- 3D3-C: trusted email-verification token issuance primitive.
-- Raw token generation remains in trusted Edge code; SQL receives only a hash.

create or replace function public.issue_email_verification_token(
    p_reservation_id uuid,
    p_token_hash bytea,
    p_requested_expires_at timestamptz
)
returns table (
    token_id uuid,
    reservation_id uuid,
    customer_id uuid,
    organisation_id uuid,
    expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_customer_id uuid;
    v_organisation_id uuid;
    v_hold_expires_at timestamptz;
    v_existing_token_id uuid;
    v_existing_created_at timestamptz;
    v_token_id uuid;
    v_expires_at timestamptz;
begin
    if p_reservation_id is null
       or p_token_hash is null
       or pg_catalog.octet_length(p_token_hash) = 0
       or p_requested_expires_at is null then
        raise exception 'Invalid email verification issuance request'
            using errcode = '22023';
    end if;

    select r.customer_id, r.organisation_id
    into v_customer_id, v_organisation_id
    from public.reservations as r
    where r.id = p_reservation_id
      and r.status = 'pending'
      and r.email_verification_status = 'pending'
    for update;

    if not found then
        raise exception 'Reservation is not eligible for email verification'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1
        from public.customers as c
        where c.id = v_customer_id
          and c.organisation_id = v_organisation_id
    ) then
        raise exception 'Reservation customer ownership is invalid'
            using errcode = 'P0001';
    end if;

    select a.hold_expires_at
    into v_hold_expires_at
    from public.allocations as a
    where a.reservation_id = p_reservation_id
      and a.status = 'held'
    order by a.created_at
    limit 1
    for update;

    if v_hold_expires_at is null or v_hold_expires_at <= pg_catalog.now() then
        raise exception 'Reservation hold is not active'
            using errcode = 'P0001';
    end if;

    select t.id, t.created_at
    into v_existing_token_id, v_existing_created_at
    from public.reservation_security_tokens as t
    where t.reservation_id = p_reservation_id
      and t.purpose = 'email_verification'
      and t.consumed_at is null
      and t.revoked_at is null
      and t.superseded_by is null
    order by t.created_at desc
    limit 1
    for update;

    if v_existing_token_id is not null
       and v_existing_created_at > pg_catalog.now() - interval '60 seconds' then
        raise exception 'Email verification resend cooldown is active'
            using errcode = 'P0004';
    end if;

    -- Revoke first so the partial active-token index cannot race a resend.
    if v_existing_token_id is not null then
        update public.reservation_security_tokens
        set revoked_at = pg_catalog.now()
        where id = v_existing_token_id;
    end if;

    v_expires_at := least(p_requested_expires_at, v_hold_expires_at);
    if v_expires_at <= pg_catalog.now() then
        raise exception 'Email verification expiry is not active'
            using errcode = 'P0001';
    end if;

    insert into public.reservation_security_tokens (
        organisation_id, reservation_id, customer_id, purpose,
        token_hash, expires_at
    )
    values (
        v_organisation_id, p_reservation_id, v_customer_id,
        'email_verification', p_token_hash, v_expires_at
    )
    returning id into v_token_id;

    if v_existing_token_id is not null then
        update public.reservation_security_tokens
        set superseded_by = v_token_id
        where id = v_existing_token_id;
    end if;

    return query
    select v_token_id, p_reservation_id, v_customer_id,
           v_organisation_id, v_expires_at;
end;
$$;

revoke all on function public.issue_email_verification_token(uuid, bytea, timestamptz)
    from public;
revoke all on function public.issue_email_verification_token(uuid, bytea, timestamptz)
    from anon, authenticated;
grant execute on function public.issue_email_verification_token(uuid, bytea, timestamptz)
    to service_role;

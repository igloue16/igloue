-- Canonicalize payment capability hashes and repair the legacy escaped form.
-- Canonical storage is one runtime backslash, x, and 64 lowercase hex digits.

do $$
declare
    v_unexpected integer;
    v_collision integer;
    v_legacy_pattern text := chr(94) || repeat(chr(92), 4) || 'x[0-9a-f]{64}$';
    v_canonical_pattern text := chr(94) || repeat(chr(92), 2) || 'x[0-9a-f]{64}$';
    v_function oid;
    v_definition text;
begin
    select count(*)::integer
    into v_unexpected
    from public.reservation_payment_capabilities as c
    where c.capability_hash is null
       or not (
           c.capability_hash ~ (chr(94) || repeat(chr(92), 2) || 'x[0-9a-f]{64}$')
           or c.capability_hash ~ (chr(94) || repeat(chr(92), 4) || 'x[0-9a-f]{64}$')
       );

    if v_unexpected <> 0 then
        raise exception 'unexpected payment capability hash representation'
            using errcode = '23514';
    end if;

    select count(*)::integer
    into v_collision
    from (
        select case
            when capability_hash ~ (chr(94) || repeat(chr(92), 4) || 'x[0-9a-f]{64}$')
                then substring(capability_hash from 2)
            else capability_hash
        end as canonical_hash
        from public.reservation_payment_capabilities
        group by 1
        having count(*) > 1
    ) as collisions;

    if v_collision <> 0 then
        raise exception 'payment capability hash canonicalization collision'
            using errcode = '23505';
    end if;

    update public.reservation_payment_capabilities
    set capability_hash = substring(capability_hash from 2)
    where capability_hash ~ (chr(94) || repeat(chr(92), 4) || 'x[0-9a-f]{64}$');

    alter table public.reservation_payment_capabilities
        drop constraint reservation_payment_capabilities_hash_check;

    alter table public.reservation_payment_capabilities
        add constraint reservation_payment_capabilities_hash_check
        check (
            length(capability_hash) = 66
            and left(capability_hash, 2) = chr(92) || 'x'
            and substring(capability_hash from 3) ~ '^[0-9a-f]{64}$'
        );

    if exists (
        select 1
        from public.reservation_payment_capabilities as c
        where length(c.capability_hash) <> 66
           or left(c.capability_hash, 2) <> chr(92) || 'x'
           or substring(c.capability_hash from 3) !~ '^[0-9a-f]{64}$'
    ) then
        raise exception 'payment capability hash canonicalization did not complete'
            using errcode = '23514';
    end if;

    for v_function in
        select p.oid
        from pg_proc as p
        where p.pronamespace = 'public'::regnamespace
          and (
              (p.proname = 'create_reservation_with_payment_capability' and p.pronargs = 25)
              or p.proname = 'initiate_reservation_payment'
          )
    loop
        select pg_get_functiondef(v_function) into v_definition;
        if position(v_legacy_pattern in v_definition) = 0 then
            raise exception 'payment capability function does not contain expected legacy validation'
                using errcode = '42809';
        end if;
        v_definition := replace(v_definition, v_legacy_pattern, v_canonical_pattern);
        execute v_definition;
    end loop;
end;
$$;

-- Backend-only V1 machine availability primitive.
-- Availability is informational; create_machine_hold remains authoritative.

create or replace function public.check_product_machine_availability(
    p_product_id text,
    p_operational_start timestamptz,
    p_operational_end timestamptz
)
returns table (
    available boolean,
    available_count integer,
    product_id text,
    operational_start timestamptz,
    operational_end timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_product_active boolean;
begin
    if p_product_id is null or btrim(p_product_id) = '' then
        raise exception 'Product is required' using errcode = '22023';
    end if;

    if p_operational_start is null or p_operational_end is null
       or p_operational_end <= p_operational_start then
        raise exception 'Operational period is invalid' using errcode = '22007';
    end if;

    select p.active
    into v_product_active
    from public.products p
    where p.id = p_product_id;

    if not found then
        raise exception 'Unknown product: %', p_product_id using errcode = 'P0002';
    end if;

    if not v_product_active then
        raise exception 'Product is inactive: %', p_product_id using errcode = 'P0001';
    end if;

    return query
    select
        count(*)::integer > 0,
        count(*)::integer,
        p_product_id,
        p_operational_start,
        p_operational_end
    from public.physical_machines pm
    where pm.product_id = p_product_id
      and pm.active = true
      and pm.status = 'available'
      and (pm.unavailable_until is null or pm.unavailable_until <= p_operational_start)
      and not exists (
          select 1
          from public.allocations a
          where a.machine_id = pm.id
            and a.status in ('held', 'reserved', 'active')
            and tstzrange(a.operational_start, a.operational_end, '[)')
                && tstzrange(p_operational_start, p_operational_end, '[)')
      );
end;
$$;

revoke all on function public.check_product_machine_availability(text, timestamptz, timestamptz) from public;
revoke all on function public.check_product_machine_availability(text, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.check_product_machine_availability(text, timestamptz, timestamptz) to service_role;


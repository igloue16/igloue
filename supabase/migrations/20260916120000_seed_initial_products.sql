insert into public.products (
    id,
    name,
    tagline,
    type,
    tier,
    cooling_capacity_kw,
    max_room_size_m2,
    weekly_price,
    deposit_amount,
    installation_required,
    service_area,
    active
)
values
    (
        'essential',
        'Essential',
        'Simple, efficace et accessible',
        'mobile',
        'essential',
        2.6,
        20,
        59.00,
        250.00,
        false,
        'local',
        true
    ),
    (
        'mobile-duo',
        'Mobile Duo',
        'Plus de puissance pour les pièces moyennes',
        'mobile',
        'mobile-duo',
        3.5,
        30,
        79.00,
        350.00,
        false,
        'greater-angouleme',
        true
    ),
    (
        'split-12',
        'Split 12',
        'Confort renforcé avec installation',
        'portable-split',
        'split-12',
        3.5,
        40,
        99.00,
        550.00,
        true,
        'charente',
        true
    ),
    (
        'max-pro',
        'Max Pro',
        'Puissance maximale pour les grands espaces',
        'mobile',
        'max-pro',
        null,
        60,
        129.00,
        750.00,
        false,
        'charente',
        true
    )
on conflict (id) do update
set
    name = excluded.name,
    tagline = excluded.tagline,
    type = excluded.type,
    tier = excluded.tier,
    cooling_capacity_kw = excluded.cooling_capacity_kw,
    max_room_size_m2 = excluded.max_room_size_m2,
    weekly_price = excluded.weekly_price,
    deposit_amount = excluded.deposit_amount,
    installation_required = excluded.installation_required,
    service_area = excluded.service_area,
    active = excluded.active;
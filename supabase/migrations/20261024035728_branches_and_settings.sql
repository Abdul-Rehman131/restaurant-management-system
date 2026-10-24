-- Branches (multi-branch prepared, not used: spec 3.2, 9.1) and the per-branch settings row.
--
-- Every business value shown in the UI (restaurant name, tax, service charge, receipt footer)
-- comes from `settings`, never from code. The pricing RULES are data too (Q1 is unanswered), so
-- the owner's answer changes a row, not the schema. Defaults follow the G7 assumptions and are
-- documented in docs/pricing-rules.md as "assumed, to be confirmed".

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function private.set_updated_at();

alter table public.branches enable row level security;

-- The single default branch. Fixed id so seeds, tests and column defaults can refer to it.
insert into public.branches (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Main');

create function private.default_branch_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;

create function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz)
$$;

create table public.settings (
  branch_id uuid primary key default private.default_branch_id()
    references public.branches (id),

  -- Restaurant details (M2). Neutral placeholders; the Admin sets the real values in P1.
  restaurant_name text not null check (length(btrim(restaurant_name)) between 1 and 120),
  address text check (length(address) <= 300),
  phone text check (length(phone) <= 30),
  receipt_footer text check (length(receipt_footer) <= 500),

  -- Money: integers in the smallest unit (PKR: paisa, 2 minor units).
  currency_code text not null default 'PKR' check (currency_code ~ '^[A-Z]{3}$'),
  currency_minor_units smallint not null default 2 check (currency_minor_units between 0 and 3),

  -- Business day (BR-04, D10, G10).
  timezone text not null default 'Asia/Karachi' check (private.is_valid_timezone(timezone)),
  day_cutoff_time time not null default '04:00' check (day_cutoff_time < '12:00'),

  -- Rates in basis points (1600 = 16%). 0 until the owner provides them (D2).
  tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
  service_charge_bps integer not null default 0 check (service_charge_bps between 0 and 10000),

  -- Pricing rules (Q1, assumed, to be confirmed). See docs/pricing-rules.md.
  prices_include_tax boolean not null default false,
  discount_reduces_charges boolean not null default true,
  service_charge_on_dine_in boolean not null default true,
  service_charge_on_take_away boolean not null default false,
  service_charge_on_delivery boolean not null default false,
  tax_on_service_charge boolean not null default false,
  rounding_mode public.rounding_mode not null default 'half_up',
  rounding_unit_minor integer not null default 1 check (rounding_unit_minor between 1 and 100000),

  -- Kitchen age colours (G11), in minutes.
  kitchen_warn_min smallint not null default 10 check (kitchen_warn_min > 0),
  kitchen_late_min smallint not null default 20,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint settings_kitchen_thresholds_order check (kitchen_late_min > kitchen_warn_min)
);

comment on table public.settings is
  'One row per branch. All business values and pricing rules; the UI never hardcodes them.';

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function private.set_updated_at();

alter table public.settings enable row level security;

insert into public.settings (branch_id, restaurant_name)
values (private.default_branch_id(), 'My Restaurant');

revoke all on all functions in schema private from public, anon, authenticated;

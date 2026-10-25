-- Menu (M2): categories and menu items. Archived with is_active = false, never deleted (BR-14).
-- Prices are integers in the smallest currency unit. Sold Out is is_available = false (BR-13).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  name text not null check (length(btrim(name)) between 1 and 60),
  image_path text check (length(image_path) <= 300),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Active category names are unique per branch (case-insensitive); archived ones may repeat.
create unique index categories_active_name_key
  on public.categories (branch_id, lower(name)) where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

alter table public.categories enable row level security;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  category_id uuid not null references public.categories (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 500),
  price bigint not null check (price >= 0),
  cost_price bigint not null default 0 check (cost_price >= 0),
  image_path text check (length(image_path) <= 300),
  prep_time_min smallint check (prep_time_min between 0 and 240),
  -- BR-07: false for items such as bottled drinks; they never reach the kitchen screen.
  needs_kitchen boolean not null default true,
  -- BR-13: Sold Out toggle.
  is_available boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_category_idx on public.menu_items (category_id) where is_active;
create unique index menu_items_active_name_key
  on public.menu_items (branch_id, lower(name)) where is_active;

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function private.set_updated_at();

alter table public.menu_items enable row level security;

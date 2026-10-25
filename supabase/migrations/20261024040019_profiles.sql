-- Staff profiles (M1). One row per login. `role` is the source of truth for permissions (T5);
-- the JWT copy is only used by the UI for routing.
--
-- Username login (G15, default until Q3 is answered): staff sign in with a username that the
-- app maps to an internal email. Staff are archived (is_active = false), never deleted.
-- Rider on-duty state is added in P3.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  username text not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 100),
  phone text check (length(phone) <= 30),
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_key on public.profiles (username);
create index profiles_role_active_idx on public.profiles (role) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

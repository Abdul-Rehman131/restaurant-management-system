-- Restaurant tables (M3). `status` is written only by the order functions, in the same
-- transaction as the order change (G13); BR-05 itself is enforced on orders.

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  number integer not null check (number between 1 and 999),
  capacity smallint not null default 4 check (capacity between 1 and 50),
  section text not null default 'Main' check (length(btrim(section)) between 1 and 40),
  status public.table_status not null default 'available',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Active table numbers are unique per branch; an archived number can be reused.
create unique index restaurant_tables_active_number_key
  on public.restaurant_tables (branch_id, number) where is_active;

create trigger restaurant_tables_set_updated_at
  before update on public.restaurant_tables
  for each row execute function private.set_updated_at();

alter table public.restaurant_tables enable row level security;

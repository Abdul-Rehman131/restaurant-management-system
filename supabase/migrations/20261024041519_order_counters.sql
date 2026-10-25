-- Order counters (BR-03): the last order number used per branch and business day. Written only
-- by private.next_order_number(), which increments atomically with INSERT ... ON CONFLICT, so
-- concurrent orders never get the same number. The sequence restarts each business day.

create table public.order_counters (
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  business_date date not null,
  last_number integer not null default 0 check (last_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, business_date)
);

create trigger order_counters_set_updated_at
  before update on public.order_counters
  for each row execute function private.set_updated_at();

alter table public.order_counters enable row level security;

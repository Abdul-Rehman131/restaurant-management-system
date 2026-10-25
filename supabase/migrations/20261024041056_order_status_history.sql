-- Order status history (spec 9.2): one row per status change, written by the order functions.
-- Append-only: rows are never updated or deleted. `changed_by` is null for system changes.

create table public.order_status_history (
  id bigint generated always as identity primary key,
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  order_id uuid not null references public.orders (id),
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references public.profiles (id),
  reason text check (length(reason) <= 300),
  changed_at timestamptz not null default now(),
  constraint order_status_history_is_change check (from_status is distinct from to_status)
);

create index order_status_history_order_idx on public.order_status_history (order_id, changed_at);

create trigger order_status_history_append_only
  before update or delete on public.order_status_history
  for each row execute function private.prevent_change();

alter table public.order_status_history enable row level security;

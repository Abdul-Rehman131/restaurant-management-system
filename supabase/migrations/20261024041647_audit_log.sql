-- Audit log (M10, BR-24): cancellations, discounts, price changes and payment voids, with user,
-- time and reason. Written by database triggers (added in P1 with the functions they audit),
-- so no screen can skip it. Append-only: rows are never updated or deleted.

create table public.audit_log (
  id bigint generated always as identity primary key,
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  user_id uuid references public.profiles (id),
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  target_table text not null check (length(target_table) <= 63),
  target_id text not null check (length(target_id) <= 64),
  reason text check (length(reason) <= 300),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (branch_id, created_at desc);
create index audit_log_target_idx on public.audit_log (target_table, target_id);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.prevent_change();

alter table public.audit_log enable row level security;

-- Payments (M7, BR-11) with void support (G8/Q8, agreed for P1: Admin only, with a reason).
--
-- One record_payment call (T6) writes 1..n tender rows that share its request_id; the
-- (request_id, tender_no) key makes retries idempotent (BR-15). Rows are never deleted or
-- edited. A mistake is corrected by VOIDING the row (Admin, reason required) and recording a
-- new payment; only non-voided rows count towards the order's paid amount.
-- Rules that do not depend on the calling function are enforced here by triggers, so no
-- screen or future function can bypass them.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  order_id uuid not null references public.orders (id),
  request_id uuid not null,
  tender_no smallint not null check (tender_no between 1 and 10),
  method public.payment_method not null,
  amount bigint not null check (amount > 0),
  -- Cash handed over by the customer; change = tendered - amount. Cash only.
  tendered bigint,
  -- Card slip or terminal reference. Card only.
  reference text check (length(reference) <= 64),
  received_by uuid not null references public.profiles (id),
  received_at timestamptz not null default now(),

  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (length(void_reason) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_request_tender_key unique (request_id, tender_no),
  constraint payments_tendered_cash_only check (
    tendered is null or (method = 'cash' and tendered >= amount)
  ),
  constraint payments_reference_card_only check (reference is null or method = 'card'),
  constraint payments_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
        and coalesce(length(btrim(void_reason)), 0) > 0)
  )
);

create index payments_order_idx on public.payments (order_id) where voided_at is null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- True when the profile is an active staff member with one of the given roles.
create function private.has_active_role(p_profile_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
     where id = p_profile_id and is_active and role = any (p_roles)
  )
$$;

-- BR-11: only an active Cashier or Admin can receive a payment.
create function private.guard_payment_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.has_active_role(new.received_by, array['admin', 'cashier']::public.app_role[]) then
    raise exception 'PAYMENT_RECEIVER_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if new.voided_at is not null then
    raise exception 'PAYMENT_VOID_ON_INSERT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A payment never changes, except for a one-time void by an active Admin.
create function private.guard_payment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'PAYMENT_ALREADY_VOIDED' using errcode = 'P0001';
  end if;

  if (new.order_id, new.request_id, new.tender_no, new.method, new.amount, new.tendered,
      new.reference, new.received_by, new.received_at, new.branch_id, new.created_at)
     is distinct from
     (old.order_id, old.request_id, old.tender_no, old.method, old.amount, old.tendered,
      old.reference, old.received_by, old.received_at, old.branch_id, old.created_at) then
    raise exception 'PAYMENT_IMMUTABLE' using errcode = 'P0001';
  end if;

  if new.voided_by is not null
     and not private.has_active_role(new.voided_by, array['admin']::public.app_role[]) then
    raise exception 'VOID_REQUIRES_ADMIN' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger payments_guard_insert
  before insert on public.payments
  for each row execute function private.guard_payment_insert();

create trigger payments_guard_update
  before update on public.payments
  for each row execute function private.guard_payment_update();

create trigger payments_no_delete
  before delete on public.payments
  for each row execute function private.prevent_change();

alter table public.payments enable row level security;

revoke all on all functions in schema private from public, anon, authenticated;

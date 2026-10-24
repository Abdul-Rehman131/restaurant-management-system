-- Order core (M4): orders, kitchen batches and order lines.
--
-- Clients never write these tables. The order functions (T6, P1) do, and they compute every
-- money column on the server (BR-01, BR-16). The constraints below are the last line of
-- defence for the business rules, independent of any function.
-- Delivery columns (zone, address, rider, delivery fee) and the P2 tracking token are added in
-- their phases.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  -- BR-03: ORD-YYYYMMDD-NNN; grows to 4+ digits after 999 orders a day (G16).
  order_number text not null check (order_number ~ '^ORD-[0-9]{8}-[0-9]{3,}$'),
  business_date date not null,
  type public.order_type not null,
  source public.order_source not null default 'staff',
  status public.order_status not null default 'accepted',
  table_id uuid references public.restaurant_tables (id),
  waiter_id uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  customer_name text check (length(customer_name) <= 80),
  customer_phone text check (length(customer_phone) <= 30),

  -- Money in minor units, all computed by private.calc_order_totals().
  subtotal bigint not null default 0 check (subtotal >= 0),
  discount bigint not null default 0 check (discount >= 0),
  discount_reason text check (length(discount_reason) <= 300),
  service_charge bigint not null default 0 check (service_charge >= 0),
  tax bigint not null default 0 check (tax >= 0),
  total bigint not null default 0 check (total >= 0),

  payment_status public.payment_status not null default 'unpaid',
  bill_requested boolean not null default false,
  bill_requested_at timestamptz,
  -- BR-15: one order per client submission.
  request_id uuid not null,

  cancel_reason text check (length(cancel_reason) <= 300),
  cancelled_by uuid references public.profiles (id),

  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Dine-In orders have a table; other types never do.
  constraint orders_table_matches_type check ((type = 'dine_in') = (table_id is not null)),
  -- BR-10: a discount always has a reason, and never exceeds the subtotal.
  constraint orders_discount_has_reason check (discount = 0 or coalesce(length(btrim(discount_reason)), 0) > 0),
  constraint orders_discount_not_above_subtotal check (discount <= subtotal),
  -- BR-12: only a fully paid order can be Completed.
  constraint orders_completed_is_paid check (status <> 'completed' or payment_status = 'paid'),
  -- Spec 6.4: a cancellation always records a reason and time.
  constraint orders_cancel_has_reason check (
    status <> 'cancelled' or (coalesce(length(btrim(cancel_reason)), 0) > 0 and cancelled_at is not null)
  ),
  constraint orders_bill_requested_time check (bill_requested = (bill_requested_at is not null))
);

create unique index orders_order_number_key on public.orders (branch_id, order_number);
create unique index orders_request_id_key on public.orders (request_id);

-- BR-05: a table has at most one open order (bill) at a time.
create unique index orders_one_open_per_table
  on public.orders (table_id)
  where table_id is not null and status not in ('completed', 'cancelled');

create index orders_business_date_idx on public.orders (branch_id, business_date);
create index orders_open_status_idx on public.orders (status)
  where status not in ('completed', 'cancelled');
create index orders_open_waiter_idx on public.orders (waiter_id)
  where status not in ('completed', 'cancelled');

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

alter table public.orders enable row level security;

-- Kitchen batches (BR-06, BR-08, G2/G3): batch 1 is the first send, later batches are ADD-ONs.
create table public.order_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  order_id uuid not null references public.orders (id),
  batch_no smallint not null check (batch_no >= 1),
  status public.batch_status not null default 'sent',
  sent_at timestamptz not null default now(),
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_batches_order_batch_key unique (order_id, batch_no)
);

create index order_batches_open_idx on public.order_batches (status)
  where status in ('sent', 'preparing');

create trigger order_batches_set_updated_at
  before update on public.order_batches
  for each row execute function private.set_updated_at();

alter table public.order_batches enable row level security;

-- Order lines with name, price and cost snapshots (BR-02). Lines are never deleted; after a
-- send they can only be cancelled with a reason (BR-09).
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null default private.default_branch_id() references public.branches (id),
  order_id uuid not null,
  batch_no smallint not null,
  menu_item_id uuid not null references public.menu_items (id),
  name_snapshot text not null check (length(btrim(name_snapshot)) > 0),
  price_snapshot bigint not null check (price_snapshot >= 0),
  cost_snapshot bigint not null default 0 check (cost_snapshot >= 0),
  needs_kitchen boolean not null,
  quantity smallint not null check (quantity between 1 and 99),
  notes text check (length(notes) <= 200),
  line_total bigint generated always as (price_snapshot * quantity) stored,
  is_cancelled boolean not null default false,
  cancel_reason text check (length(cancel_reason) <= 300),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_batch_fkey foreign key (order_id, batch_no)
    references public.order_batches (order_id, batch_no),
  constraint order_items_cancel_has_reason check (
    not is_cancelled or (coalesce(length(btrim(cancel_reason)), 0) > 0 and cancelled_at is not null)
  )
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_menu_item_idx on public.order_items (menu_item_id);

create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function private.set_updated_at();

alter table public.order_items enable row level security;

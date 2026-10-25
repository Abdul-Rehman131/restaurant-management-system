-- Helpers shared by the P1 order functions: idempotent replays (BR-15), locking an open order
-- with the waiter "own orders" rule, the order status derived from its batches (BR-08, G2,
-- G3), and the item-line validation used by create_order and add_items_to_order (BR-01,
-- BR-02, BR-13, BR-14). Internal only (private schema).

-- ===== Idempotency (BR-15) =====
-- One row per successful mutation that has no natural request_id column of its own (orders
-- and payments keep theirs). A retry with the same request id returns the stored result.
create table private.request_log (
  request_id uuid primary key,
  function_name text not null,
  user_id uuid not null,
  target_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.request_log enable row level security;
revoke all on private.request_log from public, anon, authenticated;

-- Call first in every mutation (after the role check). Takes a transaction lock on the
-- request id, so a simultaneous retry waits for the first call. Returns the stored result
-- with "replayed": true, or NULL when the request id is new.
-- Errors: REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT (the id was used by another function,
-- another user, another target, or by create_order or record_payment).
create function private.replay(p_function text, p_request_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  r private.request_log%rowtype;
begin
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('request:' || p_request_id::text, 0));

  select * into r from private.request_log where request_id = p_request_id;
  if not found then
    if exists (select 1 from public.orders where request_id = p_request_id)
       or exists (select 1 from public.payments where request_id = p_request_id) then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return null;
  end if;

  if r.function_name <> p_function
     or r.user_id is distinct from auth.uid()
     or r.target_id is distinct from p_target_id then
    raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
  end if;
  return r.result || jsonb_build_object('replayed', true);
end;
$$;

-- Call last: stores the result for replays and returns it with "replayed": false.
create function private.remember(
  p_function text,
  p_request_id uuid,
  p_target_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into private.request_log (request_id, function_name, user_id, target_id, result)
  values (p_request_id, p_function, auth.uid(), p_target_id, p_result - 'replayed');
  return (p_result - 'replayed') || jsonb_build_object('replayed', false);
end;
$$;

-- ===== Orders =====
-- Locks an open order for the caller. A waiter may act only on own orders (spec 4, G4).
-- Errors: ORDER_NOT_FOUND, NOT_AUTHORIZED (42501), ORDER_CLOSED (completed or cancelled).
create function private.lock_open_order(p_order_id uuid, p_role public.app_role)
returns public.orders
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_role = 'waiter' and v_order.waiter_id is distinct from auth.uid() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  return v_order;
end;
$$;

-- The order status follows its batches (G2, G3, BR-08). Cancelled batches are ignored.
--   any batch Sent or Preparing -> Preparing if one is Preparing, else Accepted
--   otherwise any batch Ready   -> Ready
--   otherwise (all Served)      -> Served
-- So a new kitchen batch moves a Ready or Served order back to Accepted (G2). Pending,
-- delivery and final statuses are never changed here. A change sets the status timestamp
-- and writes the history row (changed_by NULL means the system). Returns the new status.
create function private.sync_order_status(p_order_id uuid, p_changed_by uuid, p_reason text)
returns public.order_status
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_active integer;
  v_preparing integer;
  v_ready integer;
  v_served integer;
  v_new public.order_status;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status not in ('accepted', 'preparing', 'ready', 'served') then
    return v_order.status;
  end if;

  select count(*) filter (where b.status in ('sent', 'preparing')),
         count(*) filter (where b.status = 'preparing'),
         count(*) filter (where b.status = 'ready'),
         count(*) filter (where b.status = 'served')
    into v_active, v_preparing, v_ready, v_served
    from public.order_batches b
   where b.order_id = p_order_id and b.status <> 'cancelled';

  v_new := case
    when v_preparing > 0 then 'preparing'
    when v_active > 0 then 'accepted'
    when v_ready > 0 then 'ready'
    when v_served > 0 then 'served'
    else v_order.status
  end;

  if v_new <> v_order.status then
    update public.orders o
       set status = v_new,
           accepted_at = case when v_new = 'accepted' then now() else o.accepted_at end,
           preparing_at = case when v_new = 'preparing' then now() else o.preparing_at end,
           ready_at = case when v_new = 'ready' then now() else o.ready_at end,
           served_at = case when v_new = 'served' then now() else o.served_at end
     where o.id = p_order_id;
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, v_new, p_changed_by, p_reason);
  end if;
  return v_new;
end;
$$;

-- Validates order lines and snapshots them from the menu (BR-01, BR-02).
--   p_items: [{"menu_item_id": uuid, "quantity": 1..99, "notes": text|null}, ...], 1 to 50.
--   Any other key (price, total, ...) is rejected: prices come only from the menu.
-- Returns [{menu_item_id, name, price, cost, needs_kitchen, quantity, notes}, ...].
-- Errors: ITEMS_REQUIRED, ITEMS_TOO_MANY, ITEM_INVALID, ITEM_FIELD_NOT_ALLOWED,
--   QUANTITY_INVALID, NOTES_INVALID, ITEM_UNAVAILABLE (unknown, archived or sold out).
create function private.validate_order_lines(p_items jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_menu_item_id uuid;
  v_quantity bigint;
  v_notes text;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'ITEMS_TOO_MANY' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    perform private.check_json_object(
      v_item, array['menu_item_id', 'quantity', 'notes'], 'ITEM_INVALID', 'ITEM_FIELD_NOT_ALLOWED');
    v_quantity := private.json_int(v_item, 'quantity', 1, 99, 'QUANTITY_INVALID');
    v_notes := private.json_text(v_item, 'notes', 200, 'NOTES_INVALID');
    v_menu_item_id := private.json_uuid(v_item, 'menu_item_id', 'ITEM_INVALID');

    select * into v_menu from public.menu_items where id = v_menu_item_id;
    if not found or not v_menu.is_active or not v_menu.is_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = format('menu item %s is unknown, archived or sold out', v_menu_item_id);
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu.id,
      'name', v_menu.name,
      'price', v_menu.price,
      'cost', v_menu.cost_price,
      'needs_kitchen', v_menu.needs_kitchen,
      'quantity', v_quantity,
      'notes', v_notes
    ));
  end loop;
  return v_lines;
end;
$$;

-- Inserts validated lines (from validate_order_lines) into one batch of an order.
create function private.insert_order_lines(p_order_id uuid, p_batch_no smallint, p_lines jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.order_items (
    order_id, batch_no, menu_item_id, name_snapshot, price_snapshot, cost_snapshot,
    needs_kitchen, quantity, notes
  )
  select p_order_id, p_batch_no, (l ->> 'menu_item_id')::uuid, l ->> 'name',
         (l ->> 'price')::bigint, (l ->> 'cost')::bigint, (l ->> 'needs_kitchen')::boolean,
         (l ->> 'quantity')::smallint, l ->> 'notes'
    from jsonb_array_elements(p_lines) as l
$$;

-- The order summary returned by every order function now also says who owns the order and
-- whether the bill was requested.
create or replace function private.order_summary(p_order_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'business_date', o.business_date,
    'type', o.type,
    'status', o.status,
    'payment_status', o.payment_status,
    'table_id', o.table_id,
    'waiter_id', o.waiter_id,
    'bill_requested', o.bill_requested,
    'subtotal', o.subtotal,
    'discount', o.discount,
    'service_charge', o.service_charge,
    'tax', o.tax,
    'total', o.total,
    'replayed', p_replayed
  )
  from public.orders o
  where o.id = p_order_id
$$;

revoke all on all functions in schema private from public, anon, authenticated;

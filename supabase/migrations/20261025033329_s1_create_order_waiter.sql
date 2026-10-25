-- create_order, P1 version (ADR 002, plan section 5 requirement 2): an optional p_waiter_id
-- lets a Cashier or Admin create a Dine-In order for a waiter, so that waiter sees and serves
-- it. A waiter's own call keeps waiter_id = the caller and cannot name another waiter. Item
-- checks now use the shared validator (private.validate_order_lines). Everything else is as
-- in T6. The signature changes, so the old function is replaced.

drop function public.create_order(uuid, public.order_type, uuid, text, text, jsonb);

-- Creates an order with its first kitchen batch in ONE transaction.
--   p_items: [{"menu_item_id": uuid, "quantity": 1..99, "notes": text|null}, ...]
--            Any other key (price, total, ...) is rejected: prices come only from the menu
--            (BR-01) and totals only from private.calc_order_totals (BR-16).
--   p_waiter_id: optional, Dine-In only. Cashier and Admin: an active waiter. Waiter: only self.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_TYPE_REQUIRED, ORDER_TYPE_NOT_SUPPORTED, TABLE_REQUIRED,
--   TABLE_NOT_ALLOWED, TABLE_NOT_FOUND, TABLE_HAS_OPEN_ORDER, CUSTOMER_NAME_REQUIRED,
--   CUSTOMER_DETAILS_INVALID, WAITER_NOT_ALLOWED, WAITER_INVALID, ITEMS_REQUIRED,
--   ITEMS_TOO_MANY, ITEM_INVALID, ITEM_FIELD_NOT_ALLOWED, QUANTITY_INVALID, NOTES_INVALID,
--   ITEM_UNAVAILABLE.
create function public.create_order(
  p_request_id uuid,
  p_type public.order_type,
  p_table_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_waiter_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- 1. Role first. Take Away and the waiter choice are checked below once the type is known.
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter');
  v_user uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_lines jsonb;
  v_has_kitchen boolean;
  v_business_date date;
  v_order_number text;
  v_order_id uuid;
  v_waiter_id uuid;
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_customer_phone text := nullif(btrim(p_customer_phone), '');
begin
  -- 2. Idempotency (BR-15). The advisory lock makes a simultaneous retry of the same
  --    submission wait for the first one, then return its order instead of creating another.
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('create_order:' || p_request_id::text, 0));

  select * into v_existing from public.orders where request_id = p_request_id;
  if found then
    if v_existing.created_by is distinct from v_user then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return private.order_summary(v_existing.id, true);
  end if;

  -- 3. Order type and who may create it (spec 4 permission matrix).
  if p_type is null then
    raise exception 'ORDER_TYPE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type = 'delivery' then
    raise exception 'ORDER_TYPE_NOT_SUPPORTED' using errcode = 'P0001';  -- P3
  end if;
  if p_type = 'take_away' and v_role = 'waiter' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_type = 'dine_in' and p_table_id is null then
    raise exception 'TABLE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type <> 'dine_in' and p_table_id is not null then
    raise exception 'TABLE_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_type = 'take_away' and v_customer_name is null then
    raise exception 'CUSTOMER_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(length(v_customer_name), 0) > 80 or coalesce(length(v_customer_phone), 0) > 30 then
    raise exception 'CUSTOMER_DETAILS_INVALID' using errcode = 'P0001';
  end if;

  -- 4. The waiter who owns the order (G4). A waiter always owns own orders.
  if p_waiter_id is not null then
    if v_role = 'waiter' and p_waiter_id <> v_user then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    if p_type <> 'dine_in' then
      raise exception 'WAITER_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not private.has_active_role(p_waiter_id, array['waiter']::public.app_role[]) then
      raise exception 'WAITER_INVALID' using errcode = 'P0001';
    end if;
  end if;
  v_waiter_id := case when v_role = 'waiter' then v_user else p_waiter_id end;

  -- 5. Items: shape, quantity, notes, and a snapshot of each menu row (BR-01, BR-02).
  v_lines := private.validate_order_lines(p_items);
  v_has_kitchen := exists (
    select 1 from jsonb_array_elements(v_lines) l where (l ->> 'needs_kitchen')::boolean);

  -- 6. Table: lock the row so two staff cannot open the same table at once (BR-05).
  if p_type = 'dine_in' then
    select * into v_table from public.restaurant_tables where id = p_table_id for update;
    if not found or not v_table.is_active then
      raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orders o
       where o.table_id = p_table_id and o.status not in ('completed', 'cancelled')
    ) then
      raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001';
    end if;
  end if;

  -- 7. Business day and order number (BR-03, BR-04).
  v_business_date := private.business_date(now());
  v_order_number := private.next_order_number(v_business_date);

  -- 8. Order, batch 1, lines. Staff-created orders start Accepted (spec 6.4).
  insert into public.orders (
    order_number, business_date, type, source, status, table_id, waiter_id, created_by,
    customer_name, customer_phone, request_id, accepted_at
  )
  values (
    v_order_number, v_business_date, p_type, 'staff', 'accepted', p_table_id, v_waiter_id,
    v_user, v_customer_name, v_customer_phone, p_request_id, now()
  )
  returning id into v_order_id;

  insert into public.order_batches (order_id, batch_no, status, ready_at)
  values (
    v_order_id, 1,
    case when v_has_kitchen then 'sent' else 'ready' end::public.batch_status,
    case when v_has_kitchen then null else now() end
  );

  perform private.insert_order_lines(v_order_id, 1::smallint, v_lines);

  -- 9. Totals: only through the one totals function.
  perform private.calc_order_totals(v_order_id);

  -- 10. Status history; an order with no kitchen items is Ready at once (BR-07, BR-08).
  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order_id, null, 'accepted', v_user);
  perform private.sync_order_status(v_order_id, null, 'No kitchen items (BR-08)');

  -- 11. The table is now Occupied (G13: written only by order functions).
  if p_type = 'dine_in' then
    update public.restaurant_tables set status = 'occupied' where id = p_table_id;
  end if;

  return private.order_summary(v_order_id, false);
end;
$$;

comment on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb, uuid) is
  'Creates a Dine-In or counter Take Away order, optionally for a waiter (BR-01..BR-08, BR-15). See ADR 001.';

revoke all on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb, uuid)
  to authenticated;

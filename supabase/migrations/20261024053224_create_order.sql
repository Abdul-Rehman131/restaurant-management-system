-- create_order (T6, M4): Dine-In and counter Take Away orders, created by staff.
-- The pattern every business function copies is described in
-- docs/adr/001-business-logic-in-postgres.md.

-- Compact JSON summary of an order, returned by order functions (and on idempotent replays).
create function private.order_summary(p_order_id uuid, p_replayed boolean)
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

-- Creates an order with its first kitchen batch in ONE transaction.
--   p_items: [{"menu_item_id": uuid, "quantity": 1..99, "notes": text|null}, ...]
--            Any other key (price, total, ...) is rejected: prices come only from the menu
--            (BR-01) and totals only from private.calc_order_totals (BR-16).
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_TYPE_REQUIRED, ORDER_TYPE_NOT_SUPPORTED, TABLE_REQUIRED,
--   TABLE_NOT_ALLOWED, TABLE_NOT_FOUND, TABLE_HAS_OPEN_ORDER, CUSTOMER_NAME_REQUIRED,
--   CUSTOMER_DETAILS_INVALID, ITEMS_REQUIRED, ITEMS_TOO_MANY, ITEM_INVALID,
--   ITEM_FIELD_NOT_ALLOWED, QUANTITY_INVALID, NOTES_INVALID, ITEM_UNAVAILABLE.
create function public.create_order(
  p_request_id uuid,
  p_type public.order_type,
  p_table_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- 1. Role first. Take Away is checked below once the type is known.
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter');
  v_user uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_menu public.menu_items%rowtype;
  v_item jsonb;
  v_key text;
  v_quantity integer;
  v_notes text;
  v_lines jsonb := '[]'::jsonb;
  v_has_kitchen boolean := false;
  v_business_date date;
  v_order_number text;
  v_order_id uuid;
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

  -- 4. Items: shape, quantity, notes, and the menu row each one refers to.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'ITEMS_TOO_MANY' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'ITEM_INVALID' using errcode = 'P0001';
    end if;

    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('menu_item_id', 'quantity', 'notes') then
        raise exception 'ITEM_FIELD_NOT_ALLOWED' using errcode = 'P0001',
          detail = format('field "%s" is not accepted; prices come from the menu', v_key);
      end if;
    end loop;

    -- coalesce(..., 'missing'): a missing key gives NULL, and NULL <> 'x' is not true.
    if coalesce(jsonb_typeof(v_item -> 'quantity'), 'missing') <> 'number'
       or (v_item ->> 'quantity') !~ '^[0-9]{1,3}$' then
      raise exception 'QUANTITY_INVALID' using errcode = 'P0001';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity not between 1 and 99 then
      raise exception 'QUANTITY_INVALID' using errcode = 'P0001';
    end if;

    if coalesce(jsonb_typeof(v_item -> 'notes'), 'null') not in ('string', 'null') then
      raise exception 'NOTES_INVALID' using errcode = 'P0001';
    end if;
    v_notes := nullif(btrim(v_item ->> 'notes'), '');
    if coalesce(length(v_notes), 0) > 200 then
      raise exception 'NOTES_INVALID' using errcode = 'P0001';
    end if;

    if coalesce(jsonb_typeof(v_item -> 'menu_item_id'), 'missing') <> 'string'
       or (v_item ->> 'menu_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'ITEM_INVALID' using errcode = 'P0001';
    end if;

    select * into v_menu from public.menu_items where id = (v_item ->> 'menu_item_id')::uuid;
    if not found or not v_menu.is_active or not v_menu.is_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = format('menu item %s is unknown, archived or sold out', v_item ->> 'menu_item_id');
    end if;

    -- Snapshot name, price and cost now (BR-02); later menu changes never touch this order.
    v_has_kitchen := v_has_kitchen or v_menu.needs_kitchen;
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

  -- 5. Table: lock the row so two staff cannot open the same table at once (BR-05).
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

  -- 6. Business day and order number (BR-03, BR-04).
  v_business_date := private.business_date(now());
  v_order_number := private.next_order_number(v_business_date);

  -- 7. Order, batch 1, lines. Staff-created orders start Accepted (spec 6.4).
  insert into public.orders (
    order_number, business_date, type, source, status, table_id, waiter_id, created_by,
    customer_name, customer_phone, request_id, accepted_at
  )
  values (
    v_order_number, v_business_date, p_type, 'staff', 'accepted', p_table_id,
    case when v_role = 'waiter' then v_user end, v_user,
    v_customer_name, v_customer_phone, p_request_id, now()
  )
  returning id into v_order_id;

  insert into public.order_batches (order_id, batch_no, status, ready_at)
  values (
    v_order_id, 1,
    case when v_has_kitchen then 'sent' else 'ready' end::public.batch_status,
    case when v_has_kitchen then null else now() end
  );

  insert into public.order_items (
    order_id, batch_no, menu_item_id, name_snapshot, price_snapshot, cost_snapshot,
    needs_kitchen, quantity, notes
  )
  select v_order_id, 1, (l ->> 'menu_item_id')::uuid, l ->> 'name', (l ->> 'price')::bigint,
         (l ->> 'cost')::bigint, (l ->> 'needs_kitchen')::boolean, (l ->> 'quantity')::smallint,
         l ->> 'notes'
    from jsonb_array_elements(v_lines) as l;

  -- 8. Totals: only through the one totals function.
  perform private.calc_order_totals(v_order_id);

  -- 9. Status history; an order with no kitchen items is Ready at once (BR-07, BR-08).
  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order_id, null, 'accepted', v_user);

  if not v_has_kitchen then
    update public.orders set status = 'ready', ready_at = now() where id = v_order_id;
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    values (v_order_id, 'accepted', 'ready', null, 'No kitchen items (BR-08)');
  end if;

  -- 10. The table is now Occupied (G13: written only by order functions).
  if p_type = 'dine_in' then
    update public.restaurant_tables set status = 'occupied' where id = p_table_id;
  end if;

  return private.order_summary(v_order_id, false);
end;
$$;

comment on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb) is
  'Creates a Dine-In or counter Take Away order (BR-01..BR-08, BR-15). See ADR 001.';

revoke all on function private.order_summary(uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.create_order(uuid, public.order_type, uuid, text, text, jsonb)
  to authenticated;

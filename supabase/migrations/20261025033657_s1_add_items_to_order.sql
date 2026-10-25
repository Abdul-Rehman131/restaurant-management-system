-- add_items_to_order (M4, M5 "Add More Items", BR-06): adds a new batch to an open order.
-- Pattern: docs/adr/001-business-logic-in-postgres.md.
--
-- The kitchen sees only the new batch, marked ADD-ON (batch_no > 1). A batch with kitchen
-- items is Sent; a batch without (bottled drinks, BR-07) never reaches the kitchen: it is
-- Ready at once, or Served if the order is already Served (the waiter brings it directly).
-- A kitchen batch on a Ready or Served order moves the order back to Accepted (G2, system
-- transition in the history). The bill changed, so a pending bill request is cleared and the
-- table goes back from Bill Requested to Occupied. A paid order is closed for new items.
--
--   p_items: [{"menu_item_id": uuid, "quantity": 1..99, "notes": text|null}, ...]
-- Returns the order summary plus "batch_no".
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CLOSED, ORDER_ALREADY_PAID,
--   ORDER_STATUS_INVALID, ITEMS_REQUIRED, ITEMS_TOO_MANY, ITEM_INVALID,
--   ITEM_FIELD_NOT_ALLOWED, QUANTITY_INVALID, NOTES_INVALID, ITEM_UNAVAILABLE.
create function public.add_items_to_order(p_request_id uuid, p_order_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Waiter: own orders only (checked by lock_open_order).
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter');
  v_replay jsonb;
  v_order public.orders%rowtype;
  v_lines jsonb;
  v_has_kitchen boolean;
  v_batch_no smallint;
  v_batch_status public.batch_status;
begin
  v_replay := private.replay('add_items_to_order', p_request_id, p_order_id);
  if v_replay is not null then
    return v_replay;
  end if;

  v_order := private.lock_open_order(p_order_id, v_role);
  if v_order.payment_status = 'paid' then
    raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_order.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_STATUS_INVALID' using errcode = 'P0001';
  end if;

  v_lines := private.validate_order_lines(p_items);
  v_has_kitchen := exists (
    select 1 from jsonb_array_elements(v_lines) l where (l ->> 'needs_kitchen')::boolean);

  select (coalesce(max(b.batch_no), 0) + 1)::smallint into v_batch_no
    from public.order_batches b where b.order_id = p_order_id;
  v_batch_status := case
    when v_has_kitchen then 'sent'
    when v_order.status = 'served' then 'served'
    else 'ready'
  end::public.batch_status;

  insert into public.order_batches (order_id, batch_no, status, ready_at, served_at)
  values (
    p_order_id, v_batch_no, v_batch_status,
    case when v_batch_status in ('ready', 'served') then now() end,
    case when v_batch_status = 'served' then now() end
  );
  perform private.insert_order_lines(p_order_id, v_batch_no, v_lines);
  perform private.calc_order_totals(p_order_id);

  if v_order.bill_requested then
    update public.orders set bill_requested = false, bill_requested_at = null where id = p_order_id;
    if v_order.table_id is not null then
      update public.restaurant_tables set status = 'occupied'
       where id = v_order.table_id and status = 'bill_requested';
    end if;
  end if;

  perform private.sync_order_status(p_order_id, null, format('Add-on batch %s', v_batch_no));

  return private.remember('add_items_to_order', p_request_id, p_order_id,
    private.order_summary(p_order_id, false) || jsonb_build_object('batch_no', v_batch_no));
end;
$$;

comment on function public.add_items_to_order(uuid, uuid, jsonb) is
  'Adds an ADD-ON batch to an open order (BR-06, BR-07, G2, BR-15). See ADR 001.';

revoke all on function public.add_items_to_order(uuid, uuid, jsonb) from public, anon;
grant execute on function public.add_items_to_order(uuid, uuid, jsonb) to authenticated;

-- remove_or_cancel_item (M4, BR-09, spec 4): cancels one order line with a reason.
-- The cart lives on the device until Send (G5), so every line in the database has been sent:
-- removing before send happens in the app, and here only Cashier or Admin may cancel, with a
-- mandatory reason. A whole line is cancelled (its quantity is not split). Pattern: ADR 001.
--
--   * The line keeps its snapshot and is marked cancelled (never deleted).
--   * A batch with no live lines left is cancelled, so the kitchen drops it; the order status
--     follows the remaining batches (cancelling the only add-on of a Ready order makes it
--     Ready again).
--   * Totals are recalculated by private.calc_order_totals (BR-16); a discount larger than
--     the new subtotal is capped there.
--   * Cancelling the last live line cancels the order (same reason) and frees the table:
--     there is nothing left to bill.
--   * Not once paid (void the payment first). The audit entry comes from a trigger (BR-24).
-- Returns the order summary plus "order_item_id".
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ITEM_NOT_FOUND, ORDER_CLOSED, ORDER_ALREADY_PAID,
--   ORDER_STATUS_INVALID, ITEM_ALREADY_CANCELLED, REASON_REQUIRED, REASON_TOO_LONG.
create function public.remove_or_cancel_item(
  p_request_id uuid,
  p_order_item_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier');
  v_user uuid := auth.uid();
  v_args jsonb := jsonb_build_object('reason', p_reason);
  v_replay jsonb;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_reason text;
begin
  v_replay := private.replay('remove_or_cancel_item', p_request_id, p_order_item_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_item from public.order_items where id = p_order_item_id;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_order := private.lock_open_order(v_item.order_id, v_role);
  select * into v_item from public.order_items where id = p_order_item_id for update;

  if v_order.payment_status = 'paid' then
    raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_order.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_STATUS_INVALID' using errcode = 'P0001';
  end if;
  if v_item.is_cancelled then
    raise exception 'ITEM_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  v_reason := private.require_reason(p_reason);

  update public.order_items
     set is_cancelled = true, cancel_reason = v_reason, cancelled_by = v_user, cancelled_at = now()
   where id = p_order_item_id;

  update public.order_batches b
     set status = 'cancelled', cancelled_at = now()
   where b.order_id = v_item.order_id and b.batch_no = v_item.batch_no and b.status <> 'cancelled'
     and not exists (
       select 1 from public.order_items i
        where i.order_id = b.order_id and i.batch_no = b.batch_no and not i.is_cancelled);

  perform private.calc_order_totals(v_item.order_id);

  if not exists (select 1 from public.order_items i where i.order_id = v_item.order_id and not i.is_cancelled) then
    -- Nothing left to bill: the order is cancelled with the same reason.
    update public.orders
       set status = 'cancelled', cancel_reason = v_reason, cancelled_by = v_user, cancelled_at = now()
     where id = v_item.order_id;
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    values (v_item.order_id, v_order.status, 'cancelled', v_user, v_reason);
    if v_order.table_id is not null then
      update public.restaurant_tables set status = 'available' where id = v_order.table_id;
    end if;
  else
    perform private.sync_order_status(v_item.order_id, null, left('Item cancelled: ' || v_reason, 300));
  end if;

  return private.remember('remove_or_cancel_item', p_request_id, p_order_item_id,
    private.order_summary(v_item.order_id, false) || jsonb_build_object('order_item_id', p_order_item_id),
    v_args);
end;
$$;

comment on function public.remove_or_cancel_item(uuid, uuid, text) is
  'Cashier or Admin cancels a sent order line with a reason; totals recalculated (BR-09, BR-16, BR-15). See ADR 001.';

revoke all on function public.remove_or_cancel_item(uuid, uuid, text) from public, anon;
grant execute on function public.remove_or_cancel_item(uuid, uuid, text) to authenticated;

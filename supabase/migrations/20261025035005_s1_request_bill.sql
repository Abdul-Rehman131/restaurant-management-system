-- request_bill (M5, spec 6.1 step 6): flags an open order as Bill Requested so it rises to
-- the top of the cashier's open bills; a Dine-In table shows Bill Requested (G13: table
-- status is written only by order functions). "Bill Requested" is a flag on the order, not
-- a status (spec 6.4). Asking again is a no-op. Adding items later clears the flag
-- (add_items_to_order). Pattern: docs/adr/001-business-logic-in-postgres.md.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CLOSED, ORDER_ALREADY_PAID,
--   ORDER_STATUS_INVALID.
create function public.request_bill(p_request_id uuid, p_order_id uuid)
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
begin
  v_replay := private.replay('request_bill', p_request_id, p_order_id);
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

  if not v_order.bill_requested then
    update public.orders set bill_requested = true, bill_requested_at = now() where id = p_order_id;
    if v_order.table_id is not null then
      update public.restaurant_tables set status = 'bill_requested' where id = v_order.table_id;
    end if;
  end if;

  return private.remember('request_bill', p_request_id, p_order_id,
    private.order_summary(p_order_id, false));
end;
$$;

comment on function public.request_bill(uuid, uuid) is
  'Flags an open order as Bill Requested; the table shows it (spec 6.1, G13, BR-15). See ADR 001.';

revoke all on function public.request_bill(uuid, uuid) from public, anon;
grant execute on function public.request_bill(uuid, uuid) to authenticated;

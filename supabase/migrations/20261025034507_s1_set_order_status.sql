-- set_order_status (M4, spec 6.4) and the shared cancel and complete steps. Kitchen states
-- (Preparing, Ready) come from the batches (set_batch_status, G3); this function covers the
-- other transitions of spec 6.4 that exist in P1. Pattern: docs/adr/001.
--
--   to Served     Dine-In, from Ready. Admin, Cashier, Waiter (own). All Ready batches become
--                 Served. If the order is already paid it is Completed at once (BR-12).
--   to Completed  from Ready (Take Away handover) or Served, only when paid (BR-12).
--                 Admin, Cashier.
--   to Cancelled  from Pending, Accepted or Preparing, with a reason (BR-09, spec 6.4).
--                 Admin, Cashier. Not after Ready, and not once paid (void the payment first).
--   Preparing, Ready: KITCHEN_STATUS_USE_BATCHES. Accepted (P2 accept_order) and the delivery
--   states (P3) are not available: STATUS_TRANSITION_NOT_ALLOWED.

-- Completes a fulfilled, paid order and frees its table (BR-12). The caller has locked it.
create function private.complete_order(p_order_id uuid, p_changed_by uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  update public.orders set status = 'completed', completed_at = now() where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (p_order_id, v_order.status, 'completed', p_changed_by);
  if v_order.table_id is not null then
    update public.restaurant_tables set status = 'available' where id = v_order.table_id;
  end if;
end;
$$;

-- Cancels a locked, open order (spec 6.4, BR-09). Open batches are cancelled, so the kitchen
-- drops them, and the table is freed (BR-05). The reason is mandatory.
-- Errors: ORDER_CANNOT_BE_CANCELLED (Ready, Served or a delivery state), ORDER_ALREADY_PAID,
--   REASON_REQUIRED, REASON_TOO_LONG.
create function private.cancel_order(p_order_id uuid, p_changed_by uuid, p_reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status not in ('pending', 'accepted', 'preparing') then
    raise exception 'ORDER_CANNOT_BE_CANCELLED' using errcode = 'P0001',
      detail = format('an order that is %s cannot be cancelled', v_order.status);
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;
  v_reason := private.require_reason(p_reason);

  update public.order_batches
     set status = 'cancelled', cancelled_at = now()
   where order_id = p_order_id and status <> 'cancelled';
  update public.orders
     set status = 'cancelled', cancel_reason = v_reason, cancelled_by = p_changed_by,
         cancelled_at = now()
   where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  values (p_order_id, v_order.status, 'cancelled', p_changed_by, v_reason);
  if v_order.table_id is not null then
    update public.restaurant_tables set status = 'available' where id = v_order.table_id;
  end if;
end;
$$;

-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CLOSED, STATUS_REQUIRED,
--   KITCHEN_STATUS_USE_BATCHES, STATUS_TRANSITION_NOT_ALLOWED, ORDER_NOT_PAID,
--   ORDER_CANNOT_BE_CANCELLED, ORDER_ALREADY_PAID, REASON_REQUIRED, REASON_TOO_LONG.
create function public.set_order_status(
  p_request_id uuid,
  p_order_id uuid,
  p_status public.order_status,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter', 'chef');
  v_user uuid := auth.uid();
  v_args jsonb := jsonb_build_object('status', p_status, 'reason', p_reason);
  v_replay jsonb;
  v_order public.orders%rowtype;
begin
  -- Who may set which status (spec 4). The chef works on batches only.
  if p_status is null then
    raise exception 'STATUS_REQUIRED' using errcode = 'P0001';
  end if;
  if p_status in ('preparing', 'ready') then
    if v_role = 'waiter' then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    raise exception 'KITCHEN_STATUS_USE_BATCHES' using errcode = 'P0001';
  end if;
  if v_role = 'chef'
     or (v_role = 'waiter' and p_status <> 'served') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_replay := private.replay('set_order_status', p_request_id, p_order_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  v_order := private.lock_open_order(p_order_id, v_role);

  case p_status
    when 'served' then
      if v_order.type <> 'dine_in' or v_order.status <> 'ready' then
        raise exception 'STATUS_TRANSITION_NOT_ALLOWED' using errcode = 'P0001',
          detail = format('%s %s -> served', v_order.type, v_order.status);
      end if;
      update public.order_batches
         set status = 'served', served_at = now()
       where order_id = p_order_id and status = 'ready';
      perform private.sync_order_status(p_order_id, v_user, private.clean_text(p_reason, 300, 'REASON_TOO_LONG'));
      if v_order.payment_status = 'paid' then
        perform private.complete_order(p_order_id, v_user);
      end if;

    when 'completed' then
      if not ((v_order.type = 'take_away' and v_order.status = 'ready')
              or v_order.status = 'served') then
        raise exception 'STATUS_TRANSITION_NOT_ALLOWED' using errcode = 'P0001',
          detail = format('%s %s -> completed', v_order.type, v_order.status);
      end if;
      if v_order.payment_status <> 'paid' then
        raise exception 'ORDER_NOT_PAID' using errcode = 'P0001';
      end if;
      perform private.complete_order(p_order_id, v_user);

    when 'cancelled' then
      perform private.cancel_order(p_order_id, v_user, p_reason);

    else
      raise exception 'STATUS_TRANSITION_NOT_ALLOWED' using errcode = 'P0001',
        detail = format('%s -> %s is not available', v_order.status, p_status);
  end case;

  return private.remember('set_order_status', p_request_id, p_order_id,
    private.order_summary(p_order_id, false), v_args);
end;
$$;

comment on function public.set_order_status(uuid, uuid, public.order_status, text) is
  'Served, Completed (handover) and Cancelled transitions of spec 6.4 with the spec 4 roles (BR-09, BR-12, BR-15). See ADR 001.';

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.set_order_status(uuid, uuid, public.order_status, text) from public, anon;
grant execute on function public.set_order_status(uuid, uuid, public.order_status, text) to authenticated;

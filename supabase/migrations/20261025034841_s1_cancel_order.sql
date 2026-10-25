-- cancel_order (M4, BR-09, spec 6.4): Cashier or Admin cancels an order with a reason. Every
-- order in the database has been sent (G5: the cart lives on the device until Send), so this
-- is always a cancellation after send. Same rules as set_order_status(..., 'cancelled'):
-- only from Pending, Accepted or Preparing, never once paid; open batches are cancelled and
-- the table is freed (private.cancel_order). The audit log entry is written by a trigger
-- (BR-24). Pattern: docs/adr/001-business-logic-in-postgres.md.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CLOSED, ORDER_CANNOT_BE_CANCELLED,
--   ORDER_ALREADY_PAID, REASON_REQUIRED, REASON_TOO_LONG.
create function public.cancel_order(p_request_id uuid, p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier');
  v_args jsonb := jsonb_build_object('reason', p_reason);
  v_replay jsonb;
begin
  v_replay := private.replay('cancel_order', p_request_id, p_order_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.lock_open_order(p_order_id, v_role);
  perform private.cancel_order(p_order_id, auth.uid(), p_reason);

  return private.remember('cancel_order', p_request_id, p_order_id,
    private.order_summary(p_order_id, false), v_args);
end;
$$;

comment on function public.cancel_order(uuid, uuid, text) is
  'Cashier or Admin cancels an order with a reason (BR-09, BR-15, spec 6.4). See ADR 001.';

revoke all on function public.cancel_order(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, uuid, text) to authenticated;

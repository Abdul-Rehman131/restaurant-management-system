-- apply_discount (M4, BR-10, D4): Admin applies a fixed discount to an open, unpaid order,
-- with a reason. The amount is in minor units, at most the subtotal; 0 removes the discount
-- (the reason for the removal is kept too).
-- Service charge and tax are then recalculated by private.calc_order_totals from the
-- settings rules (discount_reduces_charges, docs/pricing-rules.md): the client never sends
-- a total (BR-01, BR-16). The audit entry, with old and new amount, comes from a trigger
-- (BR-24). Pattern: docs/adr/001-business-logic-in-postgres.md.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CLOSED, ORDER_ALREADY_PAID,
--   ORDER_STATUS_INVALID, DISCOUNT_INVALID, DISCOUNT_TOO_LARGE, REASON_REQUIRED,
--   REASON_TOO_LONG.
create function public.apply_discount(
  p_request_id uuid,
  p_order_id uuid,
  p_amount bigint,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin');
  v_args jsonb := jsonb_build_object('amount', p_amount, 'reason', p_reason);
  v_replay jsonb;
  v_order public.orders%rowtype;
  v_reason text;
begin
  v_replay := private.replay('apply_discount', p_request_id, p_order_id, v_args);
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
  if p_amount is null or p_amount < 0 then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;
  v_reason := private.require_reason(p_reason);

  -- Compare with the subtotal as the totals function sees it now.
  perform private.calc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  if p_amount > v_order.subtotal then
    raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001',
      detail = format('discount %s is above the subtotal %s', p_amount, v_order.subtotal);
  end if;

  update public.orders
     set discount = p_amount,
         discount_reason = v_reason
   where id = p_order_id;
  perform private.calc_order_totals(p_order_id);

  return private.remember('apply_discount', p_request_id, p_order_id,
    private.order_summary(p_order_id, false), v_args);
end;
$$;

comment on function public.apply_discount(uuid, uuid, bigint, text) is
  'Admin applies or removes a fixed discount with a reason; totals recalculated (BR-10, BR-16, BR-15). See ADR 001.';

revoke all on function public.apply_discount(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.apply_discount(uuid, uuid, bigint, text) to authenticated;

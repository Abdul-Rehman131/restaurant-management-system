-- void_payment (M7, G8/Q8 agreed for P1): Admin voids one payment row, once, with a reason.
-- Payments are never edited or deleted; a mistake is corrected by voiding the row and
-- recording a new payment (record_payment takes the remaining amount due). The one-time,
-- Admin-only rule is also enforced by the payments trigger (T4). The audit entry comes from
-- a trigger (BR-24). Pattern: docs/adr/001-business-logic-in-postgres.md.
--
--   * The order becomes Unpaid when the remaining payments no longer cover its total.
--   * A Completed order is reopened (BR-12: Completed needs paid): Dine-In goes back to
--     Served with the bill requested and the table Bill Requested; Take Away goes back to
--     Ready. If another order has opened on that table since, the void is refused (BR-05).
-- Returns the payment summary plus "payment_id".
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, PAYMENT_NOT_FOUND, PAYMENT_ALREADY_VOIDED, REASON_REQUIRED,
--   REASON_TOO_LONG, TABLE_HAS_OPEN_ORDER.
create function public.void_payment(p_request_id uuid, p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_args jsonb := jsonb_build_object('reason', p_reason);
  v_replay jsonb;
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_reason text;
  v_paid bigint;
  v_reopen_to public.order_status;
begin
  perform private.require_role('admin');
  v_replay := private.replay('void_payment', p_request_id, p_payment_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Lock the order first, then the payment (the same order as record_payment).
  select * into v_order from public.orders where id = v_payment.order_id for update;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.voided_at is not null then
    raise exception 'PAYMENT_ALREADY_VOIDED' using errcode = 'P0001';
  end if;
  v_reason := private.require_reason(p_reason);

  if v_order.status = 'completed' then
    v_reopen_to := case v_order.type when 'dine_in' then 'served' else 'ready' end::public.order_status;
    if v_order.table_id is not null and exists (
      select 1 from public.orders o
       where o.table_id = v_order.table_id and o.id <> v_order.id
         and o.status not in ('completed', 'cancelled')
    ) then
      raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001',
        detail = 'another order is open on this table; settle it first';
    end if;
  end if;

  update public.payments
     set voided_at = now(), voided_by = v_user, void_reason = v_reason
   where id = p_payment_id;

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p where p.order_id = v_order.id and p.voided_at is null;

  if v_paid < v_order.total then
    -- One statement: "Completed needs paid" (orders_completed_is_paid) is checked per row.
    update public.orders o
       set payment_status = 'unpaid',
           status = coalesce(v_reopen_to, o.status),
           completed_at = case when v_reopen_to is null then o.completed_at end,
           bill_requested = o.bill_requested or (v_reopen_to is not null and o.type = 'dine_in'),
           bill_requested_at = case
             when o.bill_requested then o.bill_requested_at
             when v_reopen_to is not null and o.type = 'dine_in' then now()
           end
     where o.id = v_order.id;

    if v_reopen_to is not null then
      insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
      values (v_order.id, 'completed', v_reopen_to, v_user, left('Payment voided: ' || v_reason, 300));
      if v_order.table_id is not null then
        update public.restaurant_tables set status = 'bill_requested' where id = v_order.table_id;
      end if;
    end if;
  end if;

  return private.remember('void_payment', p_request_id, p_payment_id,
    private.payment_summary(v_order.id, p_request_id, false) || jsonb_build_object('payment_id', p_payment_id),
    v_args);
end;
$$;

comment on function public.void_payment(uuid, uuid, text) is
  'Admin voids a payment once with a reason; reopens a Completed order (G8, BR-12, BR-15). See ADR 001.';

revoke all on function public.void_payment(uuid, uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, uuid, text) to authenticated;

-- Audit log triggers (M10, BR-24, spec 7.4): every cancellation, discount, payment void and
-- price change is recorded with user, time and reason, by the database itself, so no screen
-- or function can skip it. Also the table moves and waiter handovers of move_order_table
-- (ADR 002). The log is append-only (T4) and readable by Admin only (T5).
--
--   action                    target          reason            old / new value
--   order.cancelled           orders          cancel_reason     status, total
--   order.discount_changed    orders          discount_reason   discount (totals follow)
--   order.table_moved         orders          -                 table_id
--   order.waiter_changed      orders          -                 waiter_id
--   order_item.cancelled      order_items     cancel_reason     line snapshot / order_id
--   payment.voided            payments        void_reason       method, amount / voided_by
--   menu_item.price_changed   menu_items      -                 price, cost_price
--
-- user_id is the calling staff member (auth.uid() with a profile), NULL for system changes
-- and migrations.

create function private.audit(
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_reason text,
  p_old jsonb,
  p_new jsonb
)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.audit_log (user_id, action, target_table, target_id, reason, old_value, new_value)
  values (
    (select p.id from public.profiles p where p.id = auth.uid()),
    p_action, p_target_table, p_target_id::text, left(p_reason, 300), p_old, p_new
  )
$$;

create function private.audit_orders()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform private.audit('order.cancelled', 'orders', new.id, new.cancel_reason,
      jsonb_build_object('status', old.status, 'total', old.total),
      jsonb_build_object('status', new.status, 'total', new.total));
  end if;
  if new.discount is distinct from old.discount
     or new.discount_reason is distinct from old.discount_reason then
    perform private.audit('order.discount_changed', 'orders', new.id, new.discount_reason,
      jsonb_build_object('discount', old.discount), jsonb_build_object('discount', new.discount));
  end if;
  if new.table_id is distinct from old.table_id then
    perform private.audit('order.table_moved', 'orders', new.id, null,
      jsonb_build_object('table_id', old.table_id), jsonb_build_object('table_id', new.table_id));
  end if;
  if new.waiter_id is distinct from old.waiter_id then
    perform private.audit('order.waiter_changed', 'orders', new.id, null,
      jsonb_build_object('waiter_id', old.waiter_id), jsonb_build_object('waiter_id', new.waiter_id));
  end if;
  return null;
end;
$$;

create function private.audit_order_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_cancelled and not old.is_cancelled then
    perform private.audit('order_item.cancelled', 'order_items', new.id, new.cancel_reason,
      jsonb_build_object('name', old.name_snapshot, 'quantity', old.quantity,
                         'price', old.price_snapshot, 'line_total', old.line_total),
      jsonb_build_object('order_id', new.order_id, 'is_cancelled', true));
  end if;
  return null;
end;
$$;

create function private.audit_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    perform private.audit('payment.voided', 'payments', new.id, new.void_reason,
      jsonb_build_object('order_id', old.order_id, 'method', old.method, 'amount', old.amount),
      jsonb_build_object('voided_by', new.voided_by, 'voided_at', new.voided_at));
  end if;
  return null;
end;
$$;

create function private.audit_menu_prices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price is distinct from old.price or new.cost_price is distinct from old.cost_price then
    perform private.audit('menu_item.price_changed', 'menu_items', new.id, null,
      jsonb_build_object('price', old.price, 'cost_price', old.cost_price),
      jsonb_build_object('price', new.price, 'cost_price', new.cost_price));
  end if;
  return null;
end;
$$;

create trigger orders_audit
  after update on public.orders
  for each row execute function private.audit_orders();

create trigger order_items_audit
  after update of is_cancelled on public.order_items
  for each row execute function private.audit_order_items();

create trigger payments_audit
  after update of voided_at on public.payments
  for each row execute function private.audit_payments();

create trigger menu_items_audit_prices
  after update of price, cost_price on public.menu_items
  for each row execute function private.audit_menu_prices();

revoke all on all functions in schema private from public, anon, authenticated;

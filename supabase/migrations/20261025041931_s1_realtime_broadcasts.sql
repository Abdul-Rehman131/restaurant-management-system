-- Realtime (M8, spec 7.3, plan section 5 requirement 3): ID-only broadcasts from database
-- triggers on private channels, and who may receive which topic.
--
-- Live events are a notification only: the payload carries ids, never names, prices or
-- totals (G6), and the screen refetches through its normal, permission-checked reads. After
-- a reconnect the screen reloads everything (T8), so a missed event loses nothing.
--
--   topic                  event           sent when                         received by
--   staff:orders           order_changed   an order is created or changed    admin, cashier
--                          batch_changed   a batch is created or changed
--   staff:kitchen          order_changed   (as above)                        admin, cashier, chef
--                          batch_changed
--   staff:waiter:<uuid>    order_changed   an order of that waiter changes   that waiter only
--                          batch_changed   (Ready alert, spec 6.1 step 4)
--   staff:tables           table_changed   a table is created or changed     admin, cashier, waiter
--   staff:menu             menu_changed    a menu item or category changes   admin, cashier, waiter, chef
--                                          (Sold Out, BR-13)
--
-- On a handover both the old and the new waiter are told. Access is decided by
-- public.my_role() and auth.uid(), never by the JWT app_role claim. There is still no INSERT
-- policy on realtime.messages: clients cannot broadcast. realtime.send() catches its own
-- errors, so a failed broadcast never rolls back a business write.

create function private.broadcast(p_topic text, p_event text, p_payload jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select realtime.send(p_payload, p_event, p_topic, true)
$$;

create function private.broadcast_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('order_id', new.id);
begin
  perform private.broadcast('staff:orders', 'order_changed', v_payload);
  perform private.broadcast('staff:kitchen', 'order_changed', v_payload);
  if new.waiter_id is not null then
    perform private.broadcast('staff:waiter:' || new.waiter_id, 'order_changed', v_payload);
  end if;
  if tg_op = 'UPDATE' and old.waiter_id is not null and old.waiter_id is distinct from new.waiter_id then
    perform private.broadcast('staff:waiter:' || old.waiter_id, 'order_changed', v_payload);
  end if;
  return null;
end;
$$;

create function private.broadcast_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('order_id', new.order_id, 'batch_id', new.id);
  v_waiter uuid;
begin
  perform private.broadcast('staff:orders', 'batch_changed', v_payload);
  perform private.broadcast('staff:kitchen', 'batch_changed', v_payload);
  select o.waiter_id into v_waiter from public.orders o where o.id = new.order_id;
  if v_waiter is not null then
    perform private.broadcast('staff:waiter:' || v_waiter, 'batch_changed', v_payload);
  end if;
  return null;
end;
$$;

create function private.broadcast_table()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.broadcast('staff:tables', 'table_changed', jsonb_build_object('table_id', new.id));
  return null;
end;
$$;

create function private.broadcast_menu()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.broadcast('staff:menu', 'menu_changed', case tg_table_name
    when 'menu_items' then jsonb_build_object('menu_item_id', new.id)
    else jsonb_build_object('category_id', new.id)
  end);
  return null;
end;
$$;

create trigger orders_broadcast
  after insert or update on public.orders
  for each row execute function private.broadcast_order();
create trigger order_batches_broadcast
  after insert or update on public.order_batches
  for each row execute function private.broadcast_batch();
create trigger restaurant_tables_broadcast
  after insert or update on public.restaurant_tables
  for each row execute function private.broadcast_table();
create trigger menu_items_broadcast
  after insert or update on public.menu_items
  for each row execute function private.broadcast_menu();
create trigger categories_broadcast
  after insert or update on public.categories
  for each row execute function private.broadcast_menu();

-- ===== Who may receive which topic (receive only, SELECT) =====
create policy staff_orders_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:orders'
    and (select public.my_role()) in ('admin', 'cashier')
  );

create policy staff_kitchen_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:kitchen'
    and (select public.my_role()) in ('admin', 'cashier', 'chef')
  );

create policy staff_waiter_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:waiter:' || (select auth.uid())::text
    and (select public.my_role()) = 'waiter'
  );

create policy staff_tables_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:tables'
    and (select public.my_role()) in ('admin', 'cashier', 'waiter')
  );

create policy staff_menu_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:menu'
    and (select public.my_role()) in ('admin', 'cashier', 'waiter', 'chef')
  );

comment on policy staff_orders_receive on realtime.messages is 'Order and batch ids for Admin and Cashier (my_role(), not the JWT).';
comment on policy staff_kitchen_receive on realtime.messages is 'Order and batch ids for the kitchen: Admin, Cashier, Chef.';
comment on policy staff_waiter_receive on realtime.messages is 'A waiter receives only own orders on staff:waiter:<own id>.';
comment on policy staff_tables_receive on realtime.messages is 'Table ids for Admin, Cashier, Waiter.';
comment on policy staff_menu_receive on realtime.messages is 'Menu item and category ids (Sold Out) for every ordering screen and the kitchen.';

revoke all on all functions in schema private from public, anon, authenticated;

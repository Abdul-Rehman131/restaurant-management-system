-- SELECT access for the `authenticated` role (T5): column grants + row policies per staff role.
--
-- Rules:
--   * Role comes from public.my_role() (profiles, by auth.uid()); NULL for deactivated staff,
--     so every policy below denies them on the next request.
--   * SELECT only. There are no INSERT/UPDATE/DELETE policies and no write grants: business
--     data changes only inside SECURITY DEFINER functions (T6, P1).
--   * Columns that must stay hidden are simply not granted:
--       menu_items.cost_price, order_items.cost_snapshot  -> Admin via RPC (next migration)
--       profiles.phone                                    -> Admin via RPC (next migration)
--   * Not granted at all: settings (role-filtered RPC public.get_settings(), next migration)
--     and order_counters (internal).
--   * Chef: no SELECT on orders, order_items or the menu. The kitchen queue and Sold Out list
--     come through RPCs without prices in P1 (get_kitchen_queue, M6).
--   * Rider: own profile only until P3.
--   * Waiter: all active tables (any waiter may take any free table, Q4), but only orders where
--     orders.waiter_id = auth.uid().
--
-- Matrix (rows visible):
--   table                  admin  cashier  waiter   chef  rider
--   branches               all    -        -        -     -
--   profiles               all    all      all      self  self     (no phone column)
--   categories, menu_items all    all      active   -     -        (no cost_price)
--   restaurant_tables      all    all      active   -     -
--   orders + children      all    all      own      -     -        (no cost_snapshot)
--   payments               all    all      -        -     -
--   audit_log              all    -        -        -     -

-- branches
grant select on public.branches to authenticated;
create policy branches_select on public.branches
  for select to authenticated
  using ((select public.my_role()) = 'admin');

-- profiles (no phone)
grant select (id, branch_id, username, full_name, role, is_active, created_at, updated_at)
  on public.profiles to authenticated;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier', 'waiter')
    or (id = (select auth.uid()) and (select public.my_role()) is not null)
  );

-- categories
grant select on public.categories to authenticated;
create policy categories_select on public.categories
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and is_active)
  );

-- menu_items (no cost_price)
grant select (id, branch_id, category_id, name, description, price, image_path, prep_time_min,
              needs_kitchen, is_available, sort_order, is_active, created_at, updated_at)
  on public.menu_items to authenticated;
create policy menu_items_select on public.menu_items
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and is_active)
  );

-- restaurant_tables
grant select on public.restaurant_tables to authenticated;
create policy restaurant_tables_select on public.restaurant_tables
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and is_active)
  );

-- orders
grant select on public.orders to authenticated;
create policy orders_select on public.orders
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and waiter_id = (select auth.uid()))
  );

-- order_batches, order_items (no cost_snapshot), order_status_history: same rows as the order
grant select on public.order_batches to authenticated;
create policy order_batches_select on public.order_batches
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and exists (
      select 1 from public.orders o
       where o.id = order_batches.order_id and o.waiter_id = (select auth.uid())))
  );

grant select (id, branch_id, order_id, batch_no, menu_item_id, name_snapshot, price_snapshot,
              needs_kitchen, quantity, notes, line_total, is_cancelled, cancel_reason,
              cancelled_by, cancelled_at, created_at, updated_at)
  on public.order_items to authenticated;
create policy order_items_select on public.order_items
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and exists (
      select 1 from public.orders o
       where o.id = order_items.order_id and o.waiter_id = (select auth.uid())))
  );

grant select on public.order_status_history to authenticated;
create policy order_status_history_select on public.order_status_history
  for select to authenticated
  using (
    (select public.my_role()) in ('admin', 'cashier')
    or ((select public.my_role()) = 'waiter' and exists (
      select 1 from public.orders o
       where o.id = order_status_history.order_id and o.waiter_id = (select auth.uid())))
  );

-- payments
grant select on public.payments to authenticated;
create policy payments_select on public.payments
  for select to authenticated
  using ((select public.my_role()) in ('admin', 'cashier'));

-- audit_log
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.my_role()) = 'admin');

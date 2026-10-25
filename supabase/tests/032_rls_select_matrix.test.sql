-- RLS SELECT matrix (T5): what each staff role can read.
-- GENERATED from the matrix in docs/plan-phase0.md T5 (and the comment block in
-- *_select_policies.sql). Expected counts are computed as the table owner (bypasses RLS) from
-- the same fixtures, then compared with what each role sees through RLS.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(88);

create function tests.visible_count(p_table text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  execute format('select count(*) from public.%I', p_table) into v_count;
  return v_count;
end;
$$;
grant execute on function tests.visible_count(text) to anon, authenticated;

-- Fixtures: staff for every role, active and archived reference rows, and orders owned by two
-- different waiters plus one counter order.
select tests.create_staff('m.admin', 'admin') as admin \gset
select tests.create_staff('m.cashier', 'cashier') as cashier \gset
select tests.create_staff('m.waiter.a', 'waiter') as waiter_a \gset
select tests.create_staff('m.waiter.b', 'waiter') as waiter_b \gset
select tests.create_staff('m.chef', 'chef') as chef \gset
select tests.create_staff('m.rider', 'rider') as rider \gset

select tests.create_table(601) as t1 \gset
select tests.create_table(602) as t2 \gset
select tests.create_table(603) as t3 \gset
update public.restaurant_tables set is_active = false where id = :'t3';

select tests.create_item('Matrix Kebab', 50000) as kebab \gset
select tests.create_item('Matrix Archived', 10000) as archived_item \gset
update public.menu_items set is_active = false where id = :'archived_item';
insert into public.categories (name, is_active) values ('Matrix Archived Category', false);

select tests.create_order('dine_in', :'t1', 1) as order_a \gset
select tests.create_order('dine_in', :'t2', 2) as order_b \gset
select tests.create_order('take_away', null, 3) as order_t \gset
update public.orders set waiter_id = :'waiter_a' where id = :'order_a';
update public.orders set waiter_id = :'waiter_b' where id = :'order_b';

insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot, price_snapshot,
                                cost_snapshot, needs_kitchen, quantity)
select o, 1, :'kebab', 'Matrix Kebab', 50000, 25000, true, 1
  from unnest(array[:'order_a', :'order_b', :'order_t']::uuid[]) as o;
insert into public.order_status_history (order_id, from_status, to_status)
select o, null, 'accepted' from unnest(array[:'order_a', :'order_b', :'order_t']::uuid[]) as o;
insert into public.payments (order_id, request_id, tender_no, method, amount, received_by)
values (:'order_t', gen_random_uuid(), 1, 'cash', 50000, :'cashier');
insert into public.audit_log (action, target_table, target_id) values ('test.matrix', 'orders', :'order_a');

-- Sanity: the fixtures really contain rows that restricted roles must NOT see
select ok((select count(*) from public.menu_items where not is_active) > 0, 'fixtures include an archived menu item');
select ok((select count(*) from public.restaurant_tables where not is_active) > 0, 'fixtures include an archived table');
select ok((select count(*) from public.orders where waiter_id is distinct from :'waiter_a') >= 2, 'fixtures include orders not owned by waiter A');

create temp table expected (who text, tbl text, n integer);
insert into expected values ('admin', 'branches', (select count(*) from public.branches));
insert into expected values ('cashier', 'branches', 0);
insert into expected values ('waiter', 'branches', 0);
insert into expected values ('chef', 'branches', 0);
insert into expected values ('rider', 'branches', 0);
insert into expected values ('admin', 'profiles', (select count(*) from public.profiles));
insert into expected values ('cashier', 'profiles', (select count(*) from public.profiles));
insert into expected values ('waiter', 'profiles', (select count(*) from public.profiles));
insert into expected values ('chef', 'profiles', 1);
insert into expected values ('rider', 'profiles', 1);
insert into expected values ('admin', 'categories', (select count(*) from public.categories));
insert into expected values ('cashier', 'categories', (select count(*) from public.categories));
insert into expected values ('waiter', 'categories', (select count(*) from public.categories where is_active));
insert into expected values ('chef', 'categories', 0);
insert into expected values ('rider', 'categories', 0);
insert into expected values ('admin', 'menu_items', (select count(*) from public.menu_items));
insert into expected values ('cashier', 'menu_items', (select count(*) from public.menu_items));
insert into expected values ('waiter', 'menu_items', (select count(*) from public.menu_items where is_active));
insert into expected values ('chef', 'menu_items', 0);
insert into expected values ('rider', 'menu_items', 0);
insert into expected values ('admin', 'restaurant_tables', (select count(*) from public.restaurant_tables));
insert into expected values ('cashier', 'restaurant_tables', (select count(*) from public.restaurant_tables));
insert into expected values ('waiter', 'restaurant_tables', (select count(*) from public.restaurant_tables where is_active));
insert into expected values ('chef', 'restaurant_tables', 0);
insert into expected values ('rider', 'restaurant_tables', 0);
insert into expected values ('admin', 'orders', (select count(*) from public.orders));
insert into expected values ('cashier', 'orders', (select count(*) from public.orders));
insert into expected values ('waiter', 'orders', (select count(*) from public.orders where waiter_id = :'waiter_a'));
insert into expected values ('chef', 'orders', 0);
insert into expected values ('rider', 'orders', 0);
insert into expected values ('admin', 'order_batches', (select count(*) from public.order_batches));
insert into expected values ('cashier', 'order_batches', (select count(*) from public.order_batches));
insert into expected values ('waiter', 'order_batches', (select count(*) from public.order_batches c join public.orders o on o.id = c.order_id where o.waiter_id = :'waiter_a'));
insert into expected values ('chef', 'order_batches', 0);
insert into expected values ('rider', 'order_batches', 0);
insert into expected values ('admin', 'order_items', (select count(*) from public.order_items));
insert into expected values ('cashier', 'order_items', (select count(*) from public.order_items));
insert into expected values ('waiter', 'order_items', (select count(*) from public.order_items c join public.orders o on o.id = c.order_id where o.waiter_id = :'waiter_a'));
insert into expected values ('chef', 'order_items', 0);
insert into expected values ('rider', 'order_items', 0);
insert into expected values ('admin', 'order_status_history', (select count(*) from public.order_status_history));
insert into expected values ('cashier', 'order_status_history', (select count(*) from public.order_status_history));
insert into expected values ('waiter', 'order_status_history', (select count(*) from public.order_status_history c join public.orders o on o.id = c.order_id where o.waiter_id = :'waiter_a'));
insert into expected values ('chef', 'order_status_history', 0);
insert into expected values ('rider', 'order_status_history', 0);
insert into expected values ('admin', 'payments', (select count(*) from public.payments));
insert into expected values ('cashier', 'payments', (select count(*) from public.payments));
insert into expected values ('waiter', 'payments', 0);
insert into expected values ('chef', 'payments', 0);
insert into expected values ('rider', 'payments', 0);
insert into expected values ('admin', 'audit_log', (select count(*) from public.audit_log));
insert into expected values ('cashier', 'audit_log', 0);
insert into expected values ('waiter', 'audit_log', 0);
insert into expected values ('chef', 'audit_log', 0);
insert into expected values ('rider', 'audit_log', 0);
grant select on expected to authenticated;

-- admin
select tests.login_as(:'admin');
select is(tests.visible_count('branches'), (select n from expected where who = 'admin' and tbl = 'branches'), 'admin: branches -> all');
select is(tests.visible_count('profiles'), (select n from expected where who = 'admin' and tbl = 'profiles'), 'admin: profiles -> all');
select is(tests.visible_count('categories'), (select n from expected where who = 'admin' and tbl = 'categories'), 'admin: categories -> all');
select is(tests.visible_count('menu_items'), (select n from expected where who = 'admin' and tbl = 'menu_items'), 'admin: menu_items -> all');
select is(tests.visible_count('restaurant_tables'), (select n from expected where who = 'admin' and tbl = 'restaurant_tables'), 'admin: restaurant_tables -> all');
select is(tests.visible_count('orders'), (select n from expected where who = 'admin' and tbl = 'orders'), 'admin: orders -> all');
select is(tests.visible_count('order_batches'), (select n from expected where who = 'admin' and tbl = 'order_batches'), 'admin: order_batches -> all');
select is(tests.visible_count('order_items'), (select n from expected where who = 'admin' and tbl = 'order_items'), 'admin: order_items -> all');
select is(tests.visible_count('order_status_history'), (select n from expected where who = 'admin' and tbl = 'order_status_history'), 'admin: order_status_history -> all');
select is(tests.visible_count('payments'), (select n from expected where who = 'admin' and tbl = 'payments'), 'admin: payments -> all');
select is(tests.visible_count('audit_log'), (select n from expected where who = 'admin' and tbl = 'audit_log'), 'admin: audit_log -> all');
select throws_ok($$ select tests.visible_count('settings') $$, '42501', null, 'admin: no direct SELECT on settings');
select throws_ok($$ select tests.visible_count('order_counters') $$, '42501', null, 'admin: no direct SELECT on order_counters');
select tests.logout();

-- cashier
select tests.login_as(:'cashier');
select is(tests.visible_count('branches'), (select n from expected where who = 'cashier' and tbl = 'branches'), 'cashier: branches -> none');
select is(tests.visible_count('profiles'), (select n from expected where who = 'cashier' and tbl = 'profiles'), 'cashier: profiles -> all');
select is(tests.visible_count('categories'), (select n from expected where who = 'cashier' and tbl = 'categories'), 'cashier: categories -> all');
select is(tests.visible_count('menu_items'), (select n from expected where who = 'cashier' and tbl = 'menu_items'), 'cashier: menu_items -> all');
select is(tests.visible_count('restaurant_tables'), (select n from expected where who = 'cashier' and tbl = 'restaurant_tables'), 'cashier: restaurant_tables -> all');
select is(tests.visible_count('orders'), (select n from expected where who = 'cashier' and tbl = 'orders'), 'cashier: orders -> all');
select is(tests.visible_count('order_batches'), (select n from expected where who = 'cashier' and tbl = 'order_batches'), 'cashier: order_batches -> all');
select is(tests.visible_count('order_items'), (select n from expected where who = 'cashier' and tbl = 'order_items'), 'cashier: order_items -> all');
select is(tests.visible_count('order_status_history'), (select n from expected where who = 'cashier' and tbl = 'order_status_history'), 'cashier: order_status_history -> all');
select is(tests.visible_count('payments'), (select n from expected where who = 'cashier' and tbl = 'payments'), 'cashier: payments -> all');
select is(tests.visible_count('audit_log'), (select n from expected where who = 'cashier' and tbl = 'audit_log'), 'cashier: audit_log -> none');
select throws_ok($$ select tests.visible_count('settings') $$, '42501', null, 'cashier: no direct SELECT on settings');
select throws_ok($$ select tests.visible_count('order_counters') $$, '42501', null, 'cashier: no direct SELECT on order_counters');
select tests.logout();

-- waiter
select tests.login_as(:'waiter_a');
select is(tests.visible_count('branches'), (select n from expected where who = 'waiter' and tbl = 'branches'), 'waiter: branches -> none');
select is(tests.visible_count('profiles'), (select n from expected where who = 'waiter' and tbl = 'profiles'), 'waiter: profiles -> all');
select is(tests.visible_count('categories'), (select n from expected where who = 'waiter' and tbl = 'categories'), 'waiter: categories -> active');
select is(tests.visible_count('menu_items'), (select n from expected where who = 'waiter' and tbl = 'menu_items'), 'waiter: menu_items -> active');
select is(tests.visible_count('restaurant_tables'), (select n from expected where who = 'waiter' and tbl = 'restaurant_tables'), 'waiter: restaurant_tables -> active');
select is(tests.visible_count('orders'), (select n from expected where who = 'waiter' and tbl = 'orders'), 'waiter: orders -> own');
select is(tests.visible_count('order_batches'), (select n from expected where who = 'waiter' and tbl = 'order_batches'), 'waiter: order_batches -> own');
select is(tests.visible_count('order_items'), (select n from expected where who = 'waiter' and tbl = 'order_items'), 'waiter: order_items -> own');
select is(tests.visible_count('order_status_history'), (select n from expected where who = 'waiter' and tbl = 'order_status_history'), 'waiter: order_status_history -> own');
select is(tests.visible_count('payments'), (select n from expected where who = 'waiter' and tbl = 'payments'), 'waiter: payments -> none');
select is(tests.visible_count('audit_log'), (select n from expected where who = 'waiter' and tbl = 'audit_log'), 'waiter: audit_log -> none');
select throws_ok($$ select tests.visible_count('settings') $$, '42501', null, 'waiter: no direct SELECT on settings');
select throws_ok($$ select tests.visible_count('order_counters') $$, '42501', null, 'waiter: no direct SELECT on order_counters');
select tests.logout();

-- chef
select tests.login_as(:'chef');
select is(tests.visible_count('branches'), (select n from expected where who = 'chef' and tbl = 'branches'), 'chef: branches -> none');
select is(tests.visible_count('profiles'), (select n from expected where who = 'chef' and tbl = 'profiles'), 'chef: profiles -> self');
select is(tests.visible_count('categories'), (select n from expected where who = 'chef' and tbl = 'categories'), 'chef: categories -> none');
select is(tests.visible_count('menu_items'), (select n from expected where who = 'chef' and tbl = 'menu_items'), 'chef: menu_items -> none');
select is(tests.visible_count('restaurant_tables'), (select n from expected where who = 'chef' and tbl = 'restaurant_tables'), 'chef: restaurant_tables -> none');
select is(tests.visible_count('orders'), (select n from expected where who = 'chef' and tbl = 'orders'), 'chef: orders -> none');
select is(tests.visible_count('order_batches'), (select n from expected where who = 'chef' and tbl = 'order_batches'), 'chef: order_batches -> none');
select is(tests.visible_count('order_items'), (select n from expected where who = 'chef' and tbl = 'order_items'), 'chef: order_items -> none');
select is(tests.visible_count('order_status_history'), (select n from expected where who = 'chef' and tbl = 'order_status_history'), 'chef: order_status_history -> none');
select is(tests.visible_count('payments'), (select n from expected where who = 'chef' and tbl = 'payments'), 'chef: payments -> none');
select is(tests.visible_count('audit_log'), (select n from expected where who = 'chef' and tbl = 'audit_log'), 'chef: audit_log -> none');
select throws_ok($$ select tests.visible_count('settings') $$, '42501', null, 'chef: no direct SELECT on settings');
select throws_ok($$ select tests.visible_count('order_counters') $$, '42501', null, 'chef: no direct SELECT on order_counters');
select tests.logout();

-- rider
select tests.login_as(:'rider');
select is(tests.visible_count('branches'), (select n from expected where who = 'rider' and tbl = 'branches'), 'rider: branches -> none');
select is(tests.visible_count('profiles'), (select n from expected where who = 'rider' and tbl = 'profiles'), 'rider: profiles -> self');
select is(tests.visible_count('categories'), (select n from expected where who = 'rider' and tbl = 'categories'), 'rider: categories -> none');
select is(tests.visible_count('menu_items'), (select n from expected where who = 'rider' and tbl = 'menu_items'), 'rider: menu_items -> none');
select is(tests.visible_count('restaurant_tables'), (select n from expected where who = 'rider' and tbl = 'restaurant_tables'), 'rider: restaurant_tables -> none');
select is(tests.visible_count('orders'), (select n from expected where who = 'rider' and tbl = 'orders'), 'rider: orders -> none');
select is(tests.visible_count('order_batches'), (select n from expected where who = 'rider' and tbl = 'order_batches'), 'rider: order_batches -> none');
select is(tests.visible_count('order_items'), (select n from expected where who = 'rider' and tbl = 'order_items'), 'rider: order_items -> none');
select is(tests.visible_count('order_status_history'), (select n from expected where who = 'rider' and tbl = 'order_status_history'), 'rider: order_status_history -> none');
select is(tests.visible_count('payments'), (select n from expected where who = 'rider' and tbl = 'payments'), 'rider: payments -> none');
select is(tests.visible_count('audit_log'), (select n from expected where who = 'rider' and tbl = 'audit_log'), 'rider: audit_log -> none');
select throws_ok($$ select tests.visible_count('settings') $$, '42501', null, 'rider: no direct SELECT on settings');
select throws_ok($$ select tests.visible_count('order_counters') $$, '42501', null, 'rider: no direct SELECT on order_counters');
select tests.logout();

-- Waiter ownership, explicitly
select tests.login_as(:'waiter_a');
select results_eq($$ select id from public.orders $$, format($$ values (%L::uuid) $$, :'order_a'),
  'waiter A sees exactly their own order, not waiter B''s or the counter order');
select tests.logout();

-- Hidden columns (no grant, not even for Admin: Admin reads them through RPCs)
select tests.login_as(:'admin');
select throws_ok($$ select cost_price from public.menu_items $$, '42501', null, 'admin: menu_items.cost_price is not directly selectable');
select throws_ok($$ select cost_snapshot from public.order_items $$, '42501', null, 'admin: order_items.cost_snapshot is not directly selectable');
select throws_ok($$ select phone from public.profiles $$, '42501', null, 'admin: profiles.phone is not directly selectable');
select tests.logout();
select tests.login_as(:'waiter_a');
select throws_ok($$ select cost_price from public.menu_items $$, '42501', null, 'waiter: menu_items.cost_price is hidden');
select lives_ok($$ select id, name, price, is_available from public.menu_items $$, 'waiter: menu columns without cost are readable');
select tests.logout();

-- Anonymous callers get nothing
select tests.login_as_anon();
select throws_ok($$ select tests.visible_count('orders') $$, '42501', null, 'anon: no access to orders');
select throws_ok($$ select tests.visible_count('menu_items') $$, '42501', null, 'anon: no access to menu_items');
select throws_ok($$ select tests.visible_count('profiles') $$, '42501', null, 'anon: no access to profiles');
select tests.logout();

-- Deactivation is denied on the next request (same session, same JWT)
update public.profiles set is_active = false where id = :'waiter_a';
select tests.login_as(:'waiter_a');

select is(tests.visible_count('branches'), 0, 'deactivated waiter: branches -> nothing');
select is(tests.visible_count('profiles'), 0, 'deactivated waiter: profiles -> nothing');
select is(tests.visible_count('categories'), 0, 'deactivated waiter: categories -> nothing');
select is(tests.visible_count('menu_items'), 0, 'deactivated waiter: menu_items -> nothing');
select is(tests.visible_count('restaurant_tables'), 0, 'deactivated waiter: restaurant_tables -> nothing');
select is(tests.visible_count('orders'), 0, 'deactivated waiter: orders -> nothing');
select is(tests.visible_count('order_batches'), 0, 'deactivated waiter: order_batches -> nothing');
select is(tests.visible_count('order_items'), 0, 'deactivated waiter: order_items -> nothing');
select is(tests.visible_count('order_status_history'), 0, 'deactivated waiter: order_status_history -> nothing');
select is(tests.visible_count('payments'), 0, 'deactivated waiter: payments -> nothing');
select is(tests.visible_count('audit_log'), 0, 'deactivated waiter: audit_log -> nothing');
select tests.logout();

select * from finish();
rollback;

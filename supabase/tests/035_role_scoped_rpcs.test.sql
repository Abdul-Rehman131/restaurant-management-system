-- Role-scoped RPCs: get_settings() returns only the fields a role may see; cost prices,
-- cost snapshots and staff phone numbers are Admin only.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

select tests.create_staff('r.admin', 'admin') as admin \gset
select tests.create_staff('r.cashier', 'cashier') as cashier \gset
select tests.create_staff('r.waiter', 'waiter') as waiter \gset
select tests.create_staff('r.chef', 'chef') as chef \gset
select tests.create_staff('r.rider', 'rider') as rider \gset
select tests.create_item('RPC Kebab', 50000) as kebab \gset
select tests.create_order('take_away', null, 1) as order_t \gset
insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot, price_snapshot,
                                cost_snapshot, needs_kitchen, quantity)
values (:'order_t', 1, :'kebab', 'RPC Kebab', 50000, 25000, true, 1);

-- Keys each role receives from get_settings()
create function tests.settings_keys()
returns text[]
language sql
as $$
  select array_agg(k order by k) from jsonb_object_keys(public.get_settings()) as k
$$;
grant execute on function tests.settings_keys() to authenticated;

select restaurant_name as expected_name from public.settings \gset

select tests.login_as(:'admin');
select ok(tests.settings_keys() @> array['tax_bps', 'rounding_mode', 'receipt_footer', 'restaurant_name'], 'admin: full settings, including pricing rules');
select is(public.get_settings() ->> 'restaurant_name', :'expected_name', 'admin: restaurant name comes from the settings table');
select is(cardinality(tests.settings_keys()), 21, 'admin: all 21 settings fields (tax_registration_number since S5)');
select tests.logout();

select tests.login_as(:'cashier');
select ok(tests.settings_keys() @> array['tax_bps', 'service_charge_bps', 'prices_include_tax'], 'cashier: pricing rules (needed for bills)');
select tests.logout();

select tests.login_as(:'waiter');
select ok(tests.settings_keys() @> array['restaurant_name', 'address', 'receipt_footer', 'kitchen_warn_min'], 'waiter: display, contact and operations fields');
select ok(not tests.settings_keys() && array['tax_bps', 'service_charge_bps', 'prices_include_tax', 'rounding_mode'], 'waiter: no money or pricing-rule fields');
select tests.logout();

select tests.login_as(:'chef');
select ok(tests.settings_keys() @> array['restaurant_name', 'kitchen_warn_min', 'kitchen_late_min'], 'chef: display and kitchen fields');
select ok(not tests.settings_keys() && array['tax_bps', 'address', 'receipt_footer'], 'chef: no money, contact or receipt fields');
select tests.logout();

select tests.login_as(:'rider');
select throws_ok($$ select public.get_settings() $$, '42501', 'NOT_AUTHORIZED', 'rider: no settings until P3');
select tests.logout();

update public.profiles set is_active = false where id = :'waiter';
select tests.login_as(:'waiter');
select throws_ok($$ select public.get_settings() $$, '42501', 'NOT_AUTHORIZED', 'deactivated staff: refused on the next request');
select tests.logout();

select tests.login_as_anon();
select throws_ok($$ select public.get_settings() $$, '42501', null, 'anon: cannot call get_settings()');
select tests.logout();

-- Admin-only RPCs
select tests.login_as(:'admin');
select is(
  (select cost_price from public.admin_menu_item_costs() where menu_item_id = :'kebab'),
  25000::bigint, 'admin: reads menu cost prices through admin_menu_item_costs()'
);
select is(
  (select cost_snapshot from public.admin_order_item_costs(:'order_t')),
  25000::bigint, 'admin: reads order cost snapshots through admin_order_item_costs()'
);
select ok(
  exists (select 1 from public.admin_staff_directory() where id = :'cashier'),
  'admin: reads the staff directory (with phone) through admin_staff_directory()'
);
select tests.logout();

select tests.login_as(:'cashier');
select throws_ok($$ select * from public.admin_menu_item_costs() $$, '42501', 'NOT_AUTHORIZED', 'cashier: no cost prices');
select throws_ok(format($$ select * from public.admin_order_item_costs(%L) $$, :'order_t'), '42501', 'NOT_AUTHORIZED', 'cashier: no cost snapshots');
select throws_ok($$ select * from public.admin_staff_directory() $$, '42501', 'NOT_AUTHORIZED', 'cashier: no staff directory');
select tests.logout();

select tests.login_as(:'chef');
select throws_ok($$ select * from public.admin_menu_item_costs() $$, '42501', 'NOT_AUTHORIZED', 'chef: no cost prices');
select tests.logout();

select tests.login_as(:'rider');
select throws_ok($$ select * from public.admin_staff_directory() $$, '42501', 'NOT_AUTHORIZED', 'rider: no staff directory');
select tests.logout();

update public.profiles set is_active = false where id = :'admin';
select tests.login_as(:'admin');
select throws_ok($$ select * from public.admin_menu_item_costs() $$, '42501', 'NOT_AUTHORIZED', 'deactivated admin: no cost prices');
select tests.logout();

select tests.login_as_anon();
select throws_ok($$ select * from public.admin_menu_item_costs() $$, '42501', null, 'anon: cannot call admin RPCs');
select tests.logout();

-- private.require_role is not reachable by the API roles
select ok(not has_function_privilege('authenticated', 'private.require_role(public.app_role[])', 'execute'), 'authenticated cannot call private.require_role');
select ok(not has_function_privilege('anon', 'private.require_role(public.app_role[])', 'execute'), 'anon cannot call private.require_role');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no USAGE on private');

select * from finish();
rollback;

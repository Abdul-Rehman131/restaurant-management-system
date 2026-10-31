-- ops_demo_data (version 2, migration demo_data_v2): the demo menu, tables and settings behind
-- `pnpm seed:staging --demo-data` (and seed.sql). service_role only; dry run by default; a second
-- run changes nothing; a project with the first demo set is upgraded (old-only rows archived);
-- refuses (OWNER_DATA_PRESENT, nothing changed) when any non-demo data exists.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(32);

grant usage on schema tests to service_role;

create function tests.as_service(p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  execute p_sql into v;
  perform tests.logout();
  return v;
end;
$f$;
create function tests.outcome_service(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    execute 'set local role service_role';
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v := case when sqlstate = 'XTEST' then 'ok' else sqlerrm end;
  end;
  perform tests.logout();
  return v;
end;
$f$;
create function tests.demo_counts() returns text language sql as $f$
  select format('%s categories, %s items, %s tables',
    (select count(*) from public.categories where is_active),
    (select count(*) from public.menu_items where is_active),
    (select count(*) from public.restaurant_tables where is_active))
$f$;
grant execute on all functions in schema tests to service_role;

select tests.create_staff('dd.admin', 'admin') as admin \gset
select tests.create_staff('dd.cashier', 'cashier') as cashier \gset
select tests.create_staff('dd.waiter', 'waiter') as waiter \gset
select tests.create_staff('dd.chef', 'chef') as chef \gset
select tests.create_staff('dd.rider', 'rider') as rider \gset

-- Only service_role (the script with the secret key): no staff role, not even an Admin.
select is(tests.outcome_as(:'admin', 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'an Admin cannot call it');
select is(tests.outcome_as(:'cashier', 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'a cashier cannot');
select is(tests.outcome_as(:'waiter', 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'a waiter cannot');
select is(tests.outcome_as(:'chef', 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'a chef cannot');
select is(tests.outcome_as(:'rider', 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'a rider cannot');
select is(tests.outcome_as(null, 'select public.ops_demo_data(false)'), 'PERMISSION_DENIED', 'anon cannot');

-- A fresh project: nothing active, the default restaurant name (what a new staging has). The
-- local seed already ran it once, so audit entries are counted from here.
select count(*) as audits_before from public.audit_log where action = 'demo.loaded' \gset
update public.menu_items set is_active = false;
update public.categories set is_active = false;
update public.restaurant_tables set is_active = false;
update public.settings set restaurant_name = 'My Restaurant', tax_bps = 0, service_charge_bps = 0,
                           address = null, phone = null, receipt_footer = null, timezone = 'UTC',
                           day_cutoff_time = '05:00';

select is(tests.as_service('select public.ops_demo_data()'),
  '{"dry_run": true, "settings": "set to demo", "categories_added": 11, "menu_items_added": 72, "menu_items_updated": 0, "archived": 0, "tables_added": 14, "tables_updated": 0}'::jsonb,
  'a dry run (the default) reports what it would add');
select is(tests.demo_counts(), '0 categories, 0 items, 0 tables', 'and adds nothing');
select is((select restaurant_name from public.settings), 'My Restaurant', 'nor changes the settings');

select is(tests.as_service('select public.ops_demo_data(false)'),
  '{"dry_run": false, "settings": "set to demo", "categories_added": 11, "menu_items_added": 72, "menu_items_updated": 0, "archived": 0, "tables_added": 14, "tables_updated": 0}'::jsonb,
  'the real run adds the demo set');
select is(tests.demo_counts(), '11 categories, 72 items, 14 tables', '11 categories, 72 items, 14 tables');
select is((select format('%s %s %s %s %s %s', restaurant_name, currency_code, timezone, day_cutoff_time, tax_bps, service_charge_bps) from public.settings),
  'Ember Kitchen (Demo) PKR Asia/Karachi 04:00:00 1600 500', 'demo name, PKR, Karachi time, 04:00 cut-off, demo rates');
select is((select price from public.menu_items where is_active and name = 'Chicken Karahi (Half)'), 150000::bigint,
  'prices are whole rupees, stored in paisa (Rs 1,500)');
select ok((select bool_and(cost_price * 100 between price * 28 and price * 42) from public.menu_items where is_active),
  'every cost price is about 30 to 40 percent of the price');
select is((select count(*)::int from public.menu_items where is_active and image_path is not null), 0, 'no photos');
select ok((select receipt_footer like 'Demo receipt.%Demo rates%' from public.settings),
  'the receipt says it is a demo and names the demo rates');
select is((select string_agg(name, ', ' order by name) from public.menu_items where is_active and not needs_kitchen and name ~ '(Can|Water)'),
  '7Up (Can), Mineral Water (1.5 L), Mineral Water (500 ml), Mirinda (Can), Pepsi (Can)',
  'canned drinks and water skip the kitchen (BR-07)');
select is((select count(*)::int from public.menu_items where is_active and not needs_kitchen), 15,
  'with the packaged desserts and everything not cooked: 15 items');
select is((select string_agg(name, ', ' order by name) from public.menu_items where is_active and not is_available),
  'Gajar Halwa, Mutton Chops (4 pcs)', 'two items start Sold Out');
select is((select string_agg(format('%s %s-%s', section, min_n, max_n), ', ' order by min_n)
             from (select section, min(number) as min_n, max(number) as max_n from public.restaurant_tables
                    where is_active group by section) s),
  'Hall 1-6, Family 7-11, Outdoor 12-14', 'tables: Hall 1 to 6, Family 7 to 11, Outdoor 12 to 14');
select is((select count(*)::int from public.audit_log where action = 'demo.loaded'), :audits_before + 1,
  'the load is in the audit log');

-- Safe to run twice: nothing more is added or changed.
select is(tests.as_service('select public.ops_demo_data(false)'),
  '{"dry_run": false, "settings": "already demo", "categories_added": 0, "menu_items_added": 0, "menu_items_updated": 0, "archived": 0, "tables_added": 0, "tables_updated": 0}'::jsonb,
  'a second run changes nothing');
select is(tests.demo_counts(), '11 categories, 72 items, 14 tables', 'the counts are unchanged');
select is((select count(*)::int from public.audit_log where action = 'demo.loaded'), :audits_before + 1,
  'and no second audit entry');

-- A project seeded with the first demo set: upgraded, old-only rows archived (never deleted).
insert into public.categories (name, sort_order) values ('Breads', 5);
insert into public.menu_items (category_id, name, price, cost_price, needs_kitchen)
select id, 'Fish Tikka', 120000, 60000, true from public.categories where name = 'Breads' and is_active;
update public.menu_items set price = 20000, cost_price = 4000 where name = 'Raita' and is_active;
update public.restaurant_tables set section = 'Hall' where number = 7 and is_active;
select is(tests.as_service('select public.ops_demo_data(false)') - 'dry_run' - 'settings',
  '{"categories_added": 0, "menu_items_added": 0, "menu_items_updated": 1, "archived": 2, "tables_added": 0, "tables_updated": 1}'::jsonb,
  'version 1 rows: Raita updated, Fish Tikka and Breads archived, table 7 moved to Family');
select is((select count(*)::int from public.menu_items where name = 'Fish Tikka' and not is_active), 1,
  'the old item is archived, not deleted');
select is((select price from public.menu_items where name = 'Raita' and is_active), 15000::bigint,
  'a kept item has the new price');
select is(tests.demo_counts(), '11 categories, 72 items, 14 tables', 'and the demo set is complete');

-- Owner data present: refused, nothing changed.
insert into public.categories (name, sort_order) values ('Owner Specials', 9);
select is(tests.outcome_service('select public.ops_demo_data(false)'), 'OWNER_DATA_PRESENT',
  'a category outside the demo set: refused');
select is(tests.outcome_service('select public.ops_demo_data(true)'), 'OWNER_DATA_PRESENT',
  'the dry run says so too');
update public.categories set is_active = false where name = 'Owner Specials';
update public.settings set restaurant_name = 'A Real Cafe';
select is(tests.outcome_service('select public.ops_demo_data(false)'), 'OWNER_DATA_PRESENT',
  'a real restaurant name: refused');
select is((select restaurant_name from public.settings), 'A Real Cafe', 'and the name is left alone');

select * from finish();
rollback;

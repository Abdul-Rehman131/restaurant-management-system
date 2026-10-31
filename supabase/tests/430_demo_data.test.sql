-- ops_demo_data: the demo menu, tables and settings behind `pnpm seed:staging -- --demo-data`
-- (and seed.sql). service_role only; dry run by default; adds only what is missing, so a second
-- run adds nothing; refuses (OWNER_DATA_PRESENT, nothing changed) when any non-demo data exists.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

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
                           address = null, phone = null, receipt_footer = null;

select is(tests.as_service('select public.ops_demo_data()'),
  '{"dry_run": true, "settings": "set to demo", "categories_added": 6, "menu_items_added": 30, "tables_added": 12}'::jsonb,
  'a dry run (the default) reports what it would add');
select is(tests.demo_counts(), '0 categories, 0 items, 0 tables', 'and adds nothing');
select is((select restaurant_name from public.settings), 'My Restaurant', 'nor changes the settings');

select is(tests.as_service('select public.ops_demo_data(false)'),
  '{"dry_run": false, "settings": "set to demo", "categories_added": 6, "menu_items_added": 30, "tables_added": 12}'::jsonb,
  'the real run adds the demo set');
select is(tests.demo_counts(), '6 categories, 30 items, 12 tables', '6 categories, 30 items, 12 tables');
select is((select format('%s %s %s', restaurant_name, tax_bps, service_charge_bps) from public.settings),
  'Ember Kitchen (Demo) 1600 500', 'the demo name and the demo rates (16%, 5%)');
select ok((select receipt_footer like 'Demo receipt.%Demo rates%' from public.settings),
  'the receipt says it is a demo and names the demo rates');
select is((select count(*)::int from public.menu_items where is_active and not needs_kitchen), 4,
  'four bottled or canned drinks skip the kitchen (BR-07)');
select is((select string_agg(name, ', ') from public.menu_items where is_active and not is_available),
  'Fish Tikka', 'one item starts Sold Out');
select is((select string_agg(distinct section, ', ' order by section) from public.restaurant_tables where is_active),
  'Family, Hall', 'tables in two sections');
select is((select count(*)::int from public.audit_log where action = 'demo.loaded'), :audits_before + 1,
  'the load is in the audit log');

-- Safe to run twice: nothing more is added or changed.
select is(tests.as_service('select public.ops_demo_data(false)'),
  '{"dry_run": false, "settings": "already demo", "categories_added": 0, "menu_items_added": 0, "tables_added": 0}'::jsonb,
  'a second run adds nothing');
select is(tests.demo_counts(), '6 categories, 30 items, 12 tables', 'the counts are unchanged');
select is((select count(*)::int from public.audit_log where action = 'demo.loaded'), :audits_before + 1,
  'and no second audit entry');

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

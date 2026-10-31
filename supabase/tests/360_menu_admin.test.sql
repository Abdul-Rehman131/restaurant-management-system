-- Menu and categories for the Admin (S5, M2): create, edit, reorder, archive and restore
-- (BR-14), photos, price changes for new orders only (BR-02), audit entries (BR-24),
-- idempotency (BR-15) and the role matrix (spec 4: Admin only; cost prices Admin only).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(70);

select tests.create_staff('mn.admin', 'admin') as admin \gset
select tests.create_staff('mn.cashier', 'cashier') as cashier \gset
select tests.create_staff('mn.waiter', 'waiter') as waiter \gset
select tests.create_staff('mn.chef', 'chef') as chef \gset
select tests.create_staff('mn.rider', 'rider') as rider \gset
select tests.create_staff('mn.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(961) as t1 \gset

create function tests.cat(p_id uuid, p_name text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.save_category(%L, %L, %L) $f$, p_request, p_id, p_name)
$$;
create function tests.item(p_id uuid, p_item jsonb, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.save_menu_item(%L, %L, %L) $f$, p_request, p_id, p_item)
$$;
create function tests.cat_active(p_id uuid, p_active boolean, p_reason text)
returns text language sql as $$
  select format($f$ select public.set_category_active(gen_random_uuid(), %L, %L, %L) $f$, p_id, p_active, p_reason)
$$;
create function tests.item_active(p_id uuid, p_active boolean, p_reason text)
returns text language sql as $$
  select format($f$ select public.set_menu_item_active(gen_random_uuid(), %L, %L, %L) $f$, p_id, p_active, p_reason)
$$;

-- ===== Categories =====
select gen_random_uuid() as reqc \gset
select tests.call_as(:'admin', tests.cat(null, '  MN Soups  ', :'reqc')) as c1 \gset
select :'c1'::jsonb -> 'category' ->> 'id' as soups \gset
select is(:'c1'::jsonb -> 'category' ->> 'name', 'MN Soups', 'a category is created, trimmed');
select is(:'c1'::jsonb ->> 'created', 'true', 'created is true');
select ok((:'c1'::jsonb -> 'category' ->> 'sort_order')::int >= (select max(sort_order) from public.categories where is_active),
  'a new category goes to the end');
select is(tests.call_as(:'admin', tests.cat(null, '  MN Soups  ', :'reqc')) ->> 'replayed', 'true', 'a double tap is a replay');
select is((select count(*)::int from public.categories where name = 'MN Soups'), 1, 'and creates one category');
select is(tests.outcome_as(:'admin', tests.cat(null, 'mn soups')), 'CATEGORY_NAME_TAKEN', 'active names are unique, any case');
select is(tests.outcome_as(:'admin', tests.cat(null, ' ')), 'CATEGORY_NAME_INVALID', 'a name is required');
select is(tests.outcome_as(:'admin', tests.cat(null, repeat('x', 61))), 'CATEGORY_NAME_INVALID', 'at most 60 characters');
select is(tests.call_as(:'admin', tests.cat(:'soups', 'MN Soup Bowls')) -> 'category' ->> 'name', 'MN Soup Bowls', 'a category is renamed');
select is(tests.outcome_as(:'admin', tests.cat(gen_random_uuid(), 'MN Nope')), 'CATEGORY_NOT_FOUND', 'an unknown category');

select tests.call_as(:'admin', tests.cat(null, 'MN Grill')) -> 'category' ->> 'id' as grill \gset

-- Reorder: every active category exactly once.
select array_agg(id order by sort_order desc, id) as reversed from public.categories where is_active \gset
select is(tests.outcome_as(:'admin', format($$ select public.reorder_categories(gen_random_uuid(), %L) $$,
  array[:'soups']::uuid[])), 'SORT_LIST_INVALID', 'a partial list is refused');
select is(tests.outcome_as(:'admin', format($$ select public.reorder_categories(gen_random_uuid(), %L) $$,
  :'reversed'::uuid[] || array[:'soups']::uuid[])), 'SORT_LIST_INVALID', 'a repeated id is refused');
select tests.call_as(:'admin', format($$ select public.reorder_categories(gen_random_uuid(), %L) $$, :'reversed')) as ro \gset
select is((select array_agg(id order by sort_order) from public.categories where is_active), :'reversed'::uuid[],
  'the categories are in the new order');
select is((select min(sort_order) from public.categories where is_active), 10, 'sort orders are 10, 20, 30, ...');

-- ===== Items =====
create function tests.soup(p_category uuid, p_name text, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('category_id', p_category, 'name', p_name, 'description', 'Hot',
    'price', p_price, 'cost_price', p_price / 4, 'prep_time_min', 12, 'needs_kitchen', true,
    'is_available', true, 'image_path', null)
$$;
select gen_random_uuid() as reqi \gset
select tests.call_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN Lentil Soup', 45000), :'reqi')) as i1 \gset
select :'i1'::jsonb -> 'item' ->> 'id' as lentil \gset
select is(:'i1'::jsonb -> 'item' ->> 'name', 'MN Lentil Soup', 'an item is created');
select is((:'i1'::jsonb -> 'item' ->> 'price')::bigint, 45000::bigint, 'with its price in minor units');
select is((:'i1'::jsonb -> 'item' ->> 'cost_price')::bigint, 11250::bigint, 'and its cost price (Admin only)');
select is(tests.call_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN Lentil Soup', 45000), :'reqi')) ->> 'replayed',
  'true', 'a double tap is a replay');
select is((select count(*)::int from public.menu_items where name = 'MN Lentil Soup'), 1, 'and creates one item');
select is(tests.call_as(:'admin', tests.item(null,
  jsonb_build_object('category_id', :'soups', 'name', 'MN Water', 'price', 8000))) -> 'item' ->> 'name',
  'MN Water', 'only category, name and price are required');
select results_eq(
  $$ select cost_price, needs_kitchen, is_available, description, prep_time_min, image_path
       from public.menu_items where name = 'MN Water' $$,
  $$ values (0::bigint, true, true, null::text, null::smallint, null::text) $$,
  'the rest has defaults');

-- Validation
select is(tests.outcome_as(:'admin', tests.item(null, '"x"')), 'ITEM_INVALID', 'not an object');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"total": 1}')),
  'ITEM_FIELD_NOT_ALLOWED', 'an unknown key');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(gen_random_uuid(), 'MN A', 100))),
  'CATEGORY_NOT_FOUND', 'an unknown category');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', ' ', 100))), 'ITEM_NAME_INVALID', 'a name is required');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'mn lentil soup', 100))),
  'ITEM_NAME_TAKEN', 'active item names are unique, any case');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', -1))), 'PRICE_INVALID', 'a negative price');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"price": 1.5}')),
  'PRICE_INVALID', 'a price with a fraction (minor units only)');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"cost_price": "5"}')),
  'PRICE_INVALID', 'a cost price that is not a number');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"prep_time_min": 241}')),
  'PREP_TIME_INVALID', 'a preparation time over 240 minutes');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"needs_kitchen": "no"}')),
  'ITEM_FLAG_INVALID', 'a flag that is not true or false');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || jsonb_build_object('description', repeat('x', 501)))),
  'DESCRIPTION_INVALID', 'a description over 500');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100) || '{"image_path": "../x.png"}')),
  'IMAGE_INVALID', 'a photo path that is not items/<uuid>.webp');
select is(tests.outcome_as(:'admin', tests.item(null, tests.soup(:'soups', 'MN A', 100)
  || jsonb_build_object('image_path', 'items/' || gen_random_uuid() || '.webp'))),
  'IMAGE_NOT_FOUND', 'a photo that was not uploaded');

-- Photo: the object exists in the bucket.
select 'items/' || gen_random_uuid() || '.webp' as photo \gset
insert into storage.objects (bucket_id, name) values ('menu-images', :'photo');
select is(tests.call_as(:'admin', tests.item(:'lentil', tests.soup(:'soups', 'MN Lentil Soup', 45000)
  || jsonb_build_object('image_path', :'photo'))) -> 'item' ->> 'image_path', :'photo', 'an uploaded photo is set');

-- ===== Price change: new orders only (BR-02) =====
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'lentil')) ->> 'order_id' as old_order \gset
select total as old_total from public.orders where id = :'old_order' \gset
select tests.call_as(:'admin', tests.item(:'lentil', tests.soup(:'soups', 'MN Lentil Soup', 50000)
  || jsonb_build_object('image_path', :'photo'))) as priced \gset
select is((select price from public.menu_items where id = :'lentil'), 50000::bigint, 'the new price is saved');
select is((select price_snapshot from public.order_items where order_id = :'old_order'), 45000::bigint,
  'the open order keeps the old price (snapshot)');
select is((select total from public.orders where id = :'old_order'), :'old_total'::bigint,
  'and its total is unchanged');
select is(
  (select (old_value ->> 'price') || ' -> ' || (new_value ->> 'price') from public.audit_log
    where action = 'menu_item.price_changed' and target_id = :'lentil' and user_id = :'admin'),
  '45000 -> 50000', 'the price change is in the audit log with the admin (BR-24)');
select is(tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'lentil')) ->> 'subtotal', '50000', 'a new order uses the new price');

-- Moving an item to another category puts it at the end there.
select tests.call_as(:'admin', tests.item(null, tests.soup(:'grill', 'MN Kebab', 60000))) -> 'item' ->> 'id' as kebab \gset
select tests.call_as(:'admin', tests.item(:'lentil', tests.soup(:'grill', 'MN Lentil Soup', 50000))) as moved \gset
select is((select category_id from public.menu_items where id = :'lentil'), :'grill'::uuid, 'an item moves category');
select ok((select sort_order from public.menu_items where id = :'lentil') > (select sort_order from public.menu_items where id = :'kebab'),
  'and goes to the end of it');
select tests.call_as(:'admin', format($$ select public.reorder_menu_items(gen_random_uuid(), %L, %L) $$,
  :'grill', array[:'lentil', :'kebab']::uuid[])) as ri \gset
select is((select array_agg(id order by sort_order) from public.menu_items where category_id = :'grill' and is_active),
  array[:'lentil', :'kebab']::uuid[], 'items are reordered within their category');
select is(tests.outcome_as(:'admin', format($$ select public.reorder_menu_items(gen_random_uuid(), %L, %L) $$,
  :'grill', array[:'kebab']::uuid[])), 'SORT_LIST_INVALID', 'every item of the category is needed');

-- ===== Archive and restore =====
select is(tests.outcome_as(:'admin', tests.item_active(:'kebab', false, ' ')), 'REASON_REQUIRED', 'archiving needs a reason');
select tests.call_as(:'admin', tests.item_active(:'kebab', false, 'Off the menu')) as arch \gset
select is(:'arch'::jsonb -> 'item' ->> 'is_active', 'false', 'an item is archived');
select is((select count(*)::int from public.menu_items where id = :'kebab'), 1, 'and never deleted (BR-14)');
select is(
  (select reason from public.audit_log where action = 'menu_item.archived' and target_id = :'kebab' and user_id = :'admin'),
  'Off the menu', 'the archive is in the audit log with the reason');
select tests.login_as(:'waiter');
select is((select count(*)::int from public.menu_items where id = :'kebab'), 0, 'the waiter no longer sees it');
select tests.logout();
select is(tests.outcome_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'kebab')), 'ITEM_UNAVAILABLE', 'it cannot be ordered');
select is(tests.outcome_as(:'admin', tests.item(:'kebab', tests.soup(:'grill', 'MN Kebab', 1))), 'ITEM_NOT_FOUND',
  'an archived item cannot be edited');
select is(tests.outcome_as(:'admin', tests.cat_active(:'grill', false, 'Closed')), 'CATEGORY_HAS_ITEMS',
  'a category with active items cannot be archived');

-- Old orders keep archived items (BR-02).
select tests.call_as(:'admin', tests.item_active(:'lentil', false, 'Seasonal')) as arch2 \gset
select is((select name_snapshot from public.order_items where order_id = :'old_order'), 'MN Lentil Soup',
  'an old order keeps the archived item');

select tests.call_as(:'admin', tests.cat_active(:'grill', false, 'Closed')) as carch \gset
select is(:'carch'::jsonb -> 'category' ->> 'is_active', 'false', 'an empty category is archived');
select is(
  (select reason from public.audit_log where action = 'category.archived' and target_id = :'grill'),
  'Closed', 'with the reason in the audit log');
select is(tests.outcome_as(:'admin', tests.item_active(:'kebab', true, null)), 'CATEGORY_ARCHIVED',
  'an item of an archived category cannot be restored');
select is(tests.outcome_as(:'admin', tests.cat(:'grill', 'MN Grill 2')), 'CATEGORY_ARCHIVED', 'nor the category renamed');
select tests.call_as(:'admin', tests.cat_active(:'grill', true, null)) as crest \gset
select is(:'crest'::jsonb -> 'category' ->> 'is_active', 'true', 'a category is restored');
select tests.call_as(:'admin', tests.item_active(:'kebab', true, null)) as rest \gset
select is(:'rest'::jsonb -> 'item' ->> 'is_active', 'true', 'and then its item');
select is((select count(*)::int from public.audit_log where action in ('category.restored', 'menu_item.restored')
            and target_id in (:'grill', :'kebab')), 2, 'restores are in the audit log');
select tests.call_as(:'admin', tests.item(null, tests.soup(:'grill', 'MN Lentil Soup', 50000))) as again \gset
select is(tests.outcome_as(:'admin', tests.item_active(:'lentil', true, null)), 'ITEM_NAME_TAKEN',
  'an item cannot be restored while another active item has its name');

-- ===== admin_menu =====
select tests.call_as(:'admin', 'select public.admin_menu()') as menu \gset
select ok((select bool_or(x ->> 'id' = :'lentil') from jsonb_array_elements(:'menu'::jsonb -> 'items') x),
  'admin_menu lists archived items');
select ok((select bool_and(x ? 'cost_price') from jsonb_array_elements(:'menu'::jsonb -> 'items') x),
  'with cost prices');

-- ===== Roles =====
select is(tests.outcome_as(:'cashier', 'select public.admin_menu()'), 'NOT_AUTHORIZED', 'cashier cannot read cost prices');
select is(tests.outcome_as(:'cashier', tests.cat(null, 'MN X')), 'NOT_AUTHORIZED', 'cashier cannot change the menu');
select is(tests.outcome_as(:'waiter', tests.item(null, tests.soup(:'soups', 'MN X', 1))), 'NOT_AUTHORIZED', 'waiter cannot');
select is(tests.outcome_as(:'chef', tests.item_active(:'kebab', false, 'x')), 'NOT_AUTHORIZED', 'chef cannot archive');
select is(tests.outcome_as(:'rider', tests.cat_active(:'soups', false, 'x')), 'NOT_AUTHORIZED', 'rider cannot');
select is(tests.outcome_as(:'former', tests.cat(null, 'MN X')), 'NOT_AUTHORIZED', 'a deactivated admin cannot');
select is(tests.outcome_as(null, 'select public.admin_menu()'), 'PERMISSION_DENIED', 'anon cannot');

select * from finish();
rollback;

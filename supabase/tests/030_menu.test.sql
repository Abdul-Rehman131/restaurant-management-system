-- Menu: price rules, kitchen flag defaults and active-name uniqueness.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.categories (id, name) values ('10000000-0000-0000-0000-000000000001', 'Test Grill');

select lives_ok(
  $$ insert into public.menu_items (category_id, name, price, cost_price)
     values ('10000000-0000-0000-0000-000000000001', 'Test Kebab', 65000, 30000) $$,
  'an item with integer price and cost is accepted'
);
select throws_ok(
  $$ insert into public.menu_items (category_id, name, price)
     values ('10000000-0000-0000-0000-000000000001', 'Negative', -1) $$,
  '23514', null, 'a negative price is rejected'
);
select throws_ok(
  $$ insert into public.menu_items (category_id, name, price, cost_price)
     values ('10000000-0000-0000-0000-000000000001', 'Bad cost', 100, -5) $$,
  '23514', null, 'a negative cost price is rejected'
);
select is(
  pg_typeof((select price from public.menu_items where name = 'Test Kebab'))::text,
  'bigint',
  'prices are stored as bigint (minor units), not floats'
);
select results_eq(
  $$ select needs_kitchen, is_available, is_active from public.menu_items where name = 'Test Kebab' $$,
  $$ values (true, true, true) $$,
  'items default to needs-kitchen, available and active'
);
select throws_ok(
  $$ insert into public.menu_items (category_id, name, price)
     values ('10000000-0000-0000-0000-000000000001', 'test kebab', 100) $$,
  '23505', null, 'active item names are unique (case-insensitive)'
);
select lives_ok(
  $$ update public.menu_items set is_active = false where name = 'Test Kebab';
     insert into public.menu_items (category_id, name, price)
     values ('10000000-0000-0000-0000-000000000001', 'Test Kebab', 70000) $$,
  'an archived name can be reused by a new active item'
);
select throws_ok(
  $$ insert into public.categories (name) values ('test grill') $$,
  '23505', null, 'active category names are unique (case-insensitive)'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.categories'::regclass, 'public.menu_items'::regclass)),
  'RLS is enabled on categories and menu_items'
);

select * from finish();
rollback;

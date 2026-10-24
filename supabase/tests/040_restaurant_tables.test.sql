-- Restaurant tables: numbering, capacity and default status.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select lives_ok(
  $$ insert into public.restaurant_tables (number, capacity, section) values (901, 4, 'Hall') $$,
  'a table is created'
);
select is(
  (select status::text from public.restaurant_tables where number = 901),
  'available',
  'new tables are available'
);
select throws_ok(
  $$ insert into public.restaurant_tables (number) values (901) $$,
  '23505', null, 'active table numbers are unique'
);
select throws_ok(
  $$ insert into public.restaurant_tables (number, capacity) values (902, 0) $$,
  '23514', null, 'capacity must be at least 1'
);
select lives_ok(
  $$ update public.restaurant_tables set is_active = false where number = 901;
     insert into public.restaurant_tables (number) values (901) $$,
  'an archived table number can be reused'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.restaurant_tables'::regclass),
  'RLS is enabled on restaurant_tables'
);

select * from finish();
rollback;

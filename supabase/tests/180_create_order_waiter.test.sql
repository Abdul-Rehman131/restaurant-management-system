-- create_order with p_waiter_id (S1, ADR 002): Cashier and Admin may create a Dine-In order
-- for an active waiter; a waiter only for self. Plus the full role matrix of create_order.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

select tests.create_staff('cw.admin', 'admin') as admin \gset
select tests.create_staff('cw.cashier', 'cashier') as cashier \gset
select tests.create_staff('cw.waiter', 'waiter') as waiter \gset
select tests.create_staff('cw.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('cw.chef', 'chef') as chef \gset
select tests.create_staff('cw.rider', 'rider') as rider \gset
select tests.create_staff('cw.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';

select tests.create_table(701) as t1 \gset
select tests.create_table(702) as t2 \gset
select tests.create_item('CW Karahi', 120000) as karahi \gset

-- A Dine-In order on table t2 for p_waiter_id, as a statement for outcome_as.
create function tests.order_for(p_waiter uuid) returns text language sql as $$
  select format($f$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null,
                    jsonb_build_array(tests.line(%L)), %L) $f$,
                (select id from public.restaurant_tables where number = 702),
                (select id from public.menu_items where name = 'CW Karahi'), p_waiter)
$$;

-- ===== Cashier creates an order for a waiter =====
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L)), %L) $$,
  :'t1', :'karahi', :'waiter')) as r1 \gset
select is(:'r1'::jsonb ->> 'waiter_id', :'waiter', 'a cashier can create a Dine-In order for a waiter');
select is((select created_by from public.orders where id = (:'r1'::jsonb ->> 'order_id')::uuid), :'cashier'::uuid,
  'created_by is still the cashier');
select tests.login_as(:'waiter');
select is((select count(*)::int from public.orders where id = (:'r1'::jsonb ->> 'order_id')::uuid), 1,
  'the named waiter sees the order (own orders)');
select tests.logout();
select tests.login_as(:'waiter2');
select is((select count(*)::int from public.orders where id = (:'r1'::jsonb ->> 'order_id')::uuid), 0,
  'another waiter does not see it');
select tests.logout();

-- ===== Who may name a waiter =====
select is(tests.outcome_as(:'admin', tests.order_for(:'waiter')), 'ok', 'admin may name a waiter');
select is(tests.outcome_as(:'cashier', tests.order_for(null)), 'ok', 'cashier may leave the waiter empty');
select is(tests.outcome_as(:'waiter', tests.order_for(:'waiter')), 'ok', 'a waiter may name self');
select is(tests.outcome_as(:'waiter', tests.order_for(:'waiter2')), 'NOT_AUTHORIZED', 'a waiter cannot name another waiter');
select is(tests.outcome_as(:'cashier', tests.order_for(:'chef')), 'WAITER_INVALID', 'the named user must be a waiter');
select is(tests.outcome_as(:'cashier', tests.order_for(:'former')), 'WAITER_INVALID', 'the named waiter must be active');
select is(tests.outcome_as(:'cashier', tests.order_for(gen_random_uuid())), 'WAITER_INVALID', 'an unknown waiter is rejected');
select is(
  tests.outcome_as(:'cashier', format(
    $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L)), %L) $$,
    :'karahi', :'waiter')),
  'WAITER_NOT_ALLOWED', 'a Take Away order has no waiter'
);

-- ===== Refused callers =====
select is(tests.outcome_as(:'chef', tests.order_for(null)), 'NOT_AUTHORIZED', 'chef cannot create orders');
select is(tests.outcome_as(:'rider', tests.order_for(null)), 'NOT_AUTHORIZED', 'rider cannot create orders');
select is(tests.outcome_as(:'former', tests.order_for(null)), 'NOT_AUTHORIZED', 'deactivated staff cannot create orders');
select is(tests.outcome_as(null, tests.order_for(null)), 'PERMISSION_DENIED', 'anon cannot call create_order');

-- The waiter's own call still makes the waiter the owner.
select tests.call_as(:'waiter', tests.order_for(null)) as r2 \gset
select is(:'r2'::jsonb ->> 'waiter_id', :'waiter', 'a waiter''s order is owned by that waiter');

select * from finish();
rollback;

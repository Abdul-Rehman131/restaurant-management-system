-- get_sales_summary (S1, M9, done criterion 8): the daily report matches hand-calculated test
-- data exactly. Demo rates: tax 16%, service charge 5% on Dine-In only.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(20);

update public.settings set tax_bps = 1600, service_charge_bps = 500;
-- Keep any other orders out of today's numbers.
update public.orders set business_date = date '2000-01-01';

select tests.create_staff('ss.admin', 'admin') as admin \gset
select tests.create_staff('ss.cashier', 'cashier') as cashier \gset
select tests.create_staff('ss.waiter', 'waiter') as waiter \gset
select tests.create_staff('ss.chef', 'chef') as chef \gset
select tests.create_staff('ss.rider', 'rider') as rider \gset
select tests.create_staff('ss.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(951) as t1 \gset
select tests.create_table(952) as t2 \gset
select tests.create_item('SS Tea', 10000, false) as tea \gset
select tests.create_item('SS Cake', 25000, false) as cake \gset

create function tests.pay(p_order uuid) returns jsonb language sql as $$
  select tests.call_as((select id from public.profiles where username = 'ss.cashier'), format(
    $f$ select public.record_payment(gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', %s))) $f$,
    p_order, (select total from public.orders where id = p_order)))
$$;

-- O1 Take Away, 2 tea: 200; tax 32; total 232.
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'A', null, jsonb_build_array(tests.line(%L, 2))) $$,
  :'tea')) ->> 'order_id' as o1 \gset
select tests.pay(:'o1') as p1 \gset
-- O2 Dine-In, cake + tea: 350; service 17.50; tax 56; total 423.50. Served, then paid.
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'t1', :'cake', :'tea')) ->> 'order_id' as o2 \gset
select tests.call_as(:'waiter', format($$ select public.set_order_status(gen_random_uuid(), %L, 'served') $$, :'o2')) as s2 \gset
select tests.pay(:'o2') as p2 \gset
-- O3 Take Away, cake with Rs 50 off: base 200; tax 32; total 232.
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'C', null, jsonb_build_array(tests.line(%L))) $$,
  :'cake')) ->> 'order_id' as o3 \gset
select tests.call_as(:'admin', format($$ select public.apply_discount(gen_random_uuid(), %L, 5000, 'Loyal guest') $$, :'o3')) as d3 \gset
select tests.pay(:'o3') as p3 \gset
-- O4 cancelled; O5 open on a table; O6 paid but not yet Served (open, not a sale yet).
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'D', null, jsonb_build_array(tests.line(%L))) $$,
  :'tea')) ->> 'order_id' as o4 \gset
update public.orders set status = 'accepted' where id = :'o4';
select tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Changed mind') $$, :'o4')) as c4 \gset
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 4))) $$,
  :'t2', :'cake')) ->> 'order_id' as o5 \gset
select tests.pay(:'o5') as p5 \gset

select results_eq(
  format($$ select status::text from public.orders where id in (%L, %L, %L) order by order_number $$, :'o1', :'o2', :'o3'),
  $$ values ('completed'::text), ('completed'), ('completed') $$,
  'fixture: three completed orders'
);

select tests.call_as(:'admin', 'select public.get_sales_summary()') as r \gset

-- ===== Headline numbers (hand-calculated above) =====
select is(:'r'::jsonb ->> 'business_date', private.business_date(now())::text, 'NULL means today''s business day (BR-04)');
select is((:'r'::jsonb ->> 'orders_count')::int, 3, 'three completed orders');
select is((:'r'::jsonb ->> 'gross_sales')::bigint, 88750::bigint, 'gross sales Rs 887.50 = 232 + 423.50 + 232');
select is((:'r'::jsonb ->> 'net_sales')::bigint, 75000::bigint, 'net sales Rs 750 = 200 + 350 + 200');
select is((:'r'::jsonb ->> 'discount')::bigint, 5000::bigint, 'discounts Rs 50');
select is((:'r'::jsonb ->> 'service_charge')::bigint, 1750::bigint, 'service charge Rs 17.50 (Dine-In only)');
select is((:'r'::jsonb ->> 'tax')::bigint, 12000::bigint, 'tax Rs 120 = 32 + 56 + 32');
select is((:'r'::jsonb ->> 'average_order_value')::bigint, 29583::bigint, 'average Rs 295.83 (88,750 / 3 rounded half up)');
select is((:'r'::jsonb ->> 'cancelled_count')::int, 1, 'one cancelled order');
select is((:'r'::jsonb ->> 'open_count')::int, 1, 'one open order (paid but not Served is not a sale yet)');

-- ===== By type and top items =====
select is(:'r'::jsonb -> 'by_type',
  '[{"type": "dine_in", "orders": 1, "sales": 42350}, {"type": "take_away", "orders": 2, "sales": 46400},
    {"type": "delivery", "orders": 0, "sales": 0}]'::jsonb,
  'sales by order type, every type listed');
select is((select jsonb_agg(x - 'menu_item_id') from jsonb_array_elements(:'r'::jsonb -> 'top_items') x),
  '[{"name": "SS Tea", "quantity": 3, "sales": 30000}, {"name": "SS Cake", "quantity": 2, "sales": 50000}]'::jsonb,
  'top items by quantity, with sales before discount');

-- ===== Another day =====
select is(tests.call_as(:'admin', 'select public.get_sales_summary(''2001-01-01'')') ->> 'orders_count', '0',
  'a day without orders reports zero');
select is(tests.call_as(:'admin', 'select public.get_sales_summary(''2001-01-01'')') -> 'top_items', '[]'::jsonb,
  'and no top items');

-- ===== Roles (spec 4: reports are Admin only) =====
select is(tests.outcome_as(:'admin', 'select public.get_sales_summary()'), 'ok', 'admin may read the report');
select is(tests.outcome_as(:'cashier', 'select public.get_sales_summary()'), 'NOT_AUTHORIZED', 'cashier may not');
select is(tests.outcome_as(:'waiter', 'select public.get_sales_summary()'), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'former', 'select public.get_sales_summary()'), 'NOT_AUTHORIZED', 'deactivated admin may not');
select is(tests.outcome_as(null, 'select public.get_sales_summary()'), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

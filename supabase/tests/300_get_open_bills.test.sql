-- get_open_bills (S1): open orders only, Bill Requested first, server totals, paid and due
-- after a split and a void, roles (Admin and Cashier).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

update public.settings set tax_bps = 0, service_charge_bps = 0;

select tests.create_staff('ob.admin', 'admin') as admin \gset
select tests.create_staff('ob.cashier', 'cashier') as cashier \gset
select tests.create_staff('ob.waiter', 'waiter') as waiter \gset
select tests.create_staff('ob.chef', 'chef') as chef \gset
select tests.create_staff('ob.rider', 'rider') as rider \gset
select tests.create_staff('ob.former', 'cashier') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(961) as t1 \gset
select tests.create_table(962) as t2 \gset
select tests.create_item('OB Tikka', 60000) as tikka \gset
select tests.create_item('OB Water', 10000, false) as water \gset

-- The local seed has no orders; keep any others out of the counts below.
update public.orders set status = 'cancelled', cancel_reason = 'test isolation', cancelled_at = now()
 where status not in ('completed', 'cancelled');

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 2))) $$,
  :'t2', :'water')) ->> 'order_id' as o2 \gset
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', '0300 0000000', jsonb_build_array(tests.line(%L))) $$,
  :'water')) ->> 'order_id' as o3 \gset
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Gone', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o4 \gset
select tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Customer left') $$, :'o4')) as c4 \gset
-- o2 asks for the bill: it must come first.
select tests.call_as(:'waiter', format($$ select public.request_bill(gen_random_uuid(), %L) $$, :'o2')) as b2 \gset

select tests.call_as(:'cashier', 'select public.get_open_bills()') -> 'bills' as bills \gset

select is(jsonb_array_length(:'bills'::jsonb), 3, 'three open orders (the cancelled one is not a bill)');
select is(:'bills'::jsonb #>> '{0,order_id}', :'o2', 'the Bill Requested order is at the top');
select is(:'bills'::jsonb #>> '{0,table_number}', '962', 'with its table number');
select is(:'bills'::jsonb #>> '{0,waiter_name}', 'Test ob.waiter', 'and its waiter');
select is(:'bills'::jsonb #>> '{1,order_id}', :'o1', 'then the rest by age');
select is(:'bills'::jsonb #>> '{2,customer_phone}', '0300 0000000', 'a Take Away bill shows the customer');
select results_eq(
  format($$ select (b ->> 'total')::bigint, (b ->> 'paid')::bigint, (b ->> 'due')::bigint
            from jsonb_array_elements(%L::jsonb) b where b ->> 'order_id' = %L $$, :'bills', :'o2'),
  $$ values (20000::bigint, 0::bigint, 20000::bigint) $$,
  'an unpaid bill: due = total'
);

-- Paid but not yet served stays on the list with nothing due (BR-12).
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 40000}, {"method": "card", "amount": 20000}]') $$,
  :'o1')) as p1 \gset
select tests.call_as(:'cashier', 'select public.get_open_bills()') -> 'bills' as bills2 \gset
select results_eq(
  format($$ select b ->> 'payment_status', (b ->> 'paid')::bigint, (b ->> 'due')::bigint
            from jsonb_array_elements(%L::jsonb) b where b ->> 'order_id' = %L $$, :'bills2', :'o1'),
  $$ values ('paid'::text, 60000::bigint, 0::bigint) $$,
  'a paid order that is not Served yet stays open with nothing due'
);
-- A voided tender counts no more.
select tests.call_as(:'admin', format($$ select public.void_payment(gen_random_uuid(), %L, 'Card reversed') $$,
  (select id from public.payments where order_id = :'o1' and method = 'card'))) as v1 \gset
select tests.call_as(:'cashier', 'select public.get_open_bills()') -> 'bills' as bills3 \gset
select results_eq(
  format($$ select b ->> 'payment_status', (b ->> 'paid')::bigint, (b ->> 'due')::bigint
            from jsonb_array_elements(%L::jsonb) b where b ->> 'order_id' = %L $$, :'bills3', :'o1'),
  $$ values ('unpaid'::text, 40000::bigint, 20000::bigint) $$,
  'after a void, only live payments count: Rs 200 due'
);

-- Completed orders leave the list.
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 10000}]') $$, :'o3')) as p3 \gset
select is(
  (select count(*)::int from jsonb_array_elements(tests.call_as(:'cashier', 'select public.get_open_bills()') -> 'bills') b
    where b ->> 'order_id' = :'o3'), 0,
  'a paid Ready Take Away order is Completed and leaves the list'
);

-- ===== Roles (spec 4) =====
select is(tests.outcome_as(:'admin', 'select public.get_open_bills()'), 'ok', 'admin may read open bills');
select is(tests.outcome_as(:'cashier', 'select public.get_open_bills()'), 'ok', 'cashier may read open bills');
select is(tests.outcome_as(:'waiter', 'select public.get_open_bills()'), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'chef', 'select public.get_open_bills()'), 'NOT_AUTHORIZED', 'chef may not (no money for the kitchen)');
select is(tests.outcome_as(:'rider', 'select public.get_open_bills()'), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', 'select public.get_open_bills()'), 'NOT_AUTHORIZED', 'deactivated cashier may not');
select is(tests.outcome_as(null, 'select public.get_open_bills()'), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

-- add_items_to_order (S1): ADD-ON batches (BR-06), drinks never reach the kitchen (BR-07),
-- a kitchen add-on reopens a Ready or Served order (G2), totals, idempotency, roles.
-- Demo rates: tax 16%, service charge 5% on Dine-In, prices exclusive of tax.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(40);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

select tests.create_staff('ai.admin', 'admin') as admin \gset
select tests.create_staff('ai.cashier', 'cashier') as cashier \gset
select tests.create_staff('ai.waiter', 'waiter') as waiter \gset
select tests.create_staff('ai.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('ai.chef', 'chef') as chef \gset
select tests.create_staff('ai.rider', 'rider') as rider \gset
select tests.create_staff('ai.former', 'waiter') as former \gset

select tests.create_table(801) as t1 \gset
select tests.create_item('AI Tikka', 60000) as tikka \gset
select tests.create_item('AI Naan', 30000) as naan \gset
select tests.create_item('AI Water', 8000, false) as water \gset
select tests.create_item('AI Sold Out', 40000) as sold_out \gset
update public.menu_items set is_available = false where id = :'sold_out';

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 2))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset
update public.profiles set is_active = false where id = :'former';

-- add(order, items) as a statement for outcome_as / call_as
create function tests.add(p_order uuid, p_items jsonb, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.add_items_to_order(%L, %L, %L) $f$, p_request, p_order, p_items)
$$;

-- ===== Add-on while batch 1 is still in the kitchen =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan'), tests.line(:'water', 1, 'chilled')), :'req1')) as r1 \gset
select is((:'r1'::jsonb ->> 'batch_no')::int, 2, 'the add-on is batch 2 (BR-06)');
select is(:'r1'::jsonb ->> 'replayed', 'false', 'a first call is not a replay');
select is((select status::text from public.order_batches where order_id = :'o1' and batch_no = 2), 'sent',
  'a batch with a kitchen item is Sent');
select results_eq(
  format($$ select name_snapshot, price_snapshot, quantity::int, notes from public.order_items
            where order_id = %L and batch_no = 2 order by name_snapshot $$, :'o1'),
  $$ values ('AI Naan'::text, 30000::bigint, 1, null::text), ('AI Water', 8000, 1, 'chilled') $$,
  'the new lines are snapshots in batch 2 (BR-02)'
);
-- 2 x 600 + 300 + 80 = 1,580; service 5% = 79; tax 16% = 252.80; total 1,911.80
select results_eq(
  format($$ select subtotal, service_charge, tax, total from public.orders where id = %L $$, :'o1'),
  $$ values (158000::bigint, 7900::bigint, 25280::bigint, 191180::bigint) $$,
  'totals are recalculated by the server (Rs 1,580 -> Rs 1,911.80)'
);
select is(:'r1'::jsonb ->> 'total', '191180', 'the result carries the new total');
select is((select status::text from public.orders where id = :'o1'), 'accepted', 'the order stays Accepted');

-- ===== Idempotency (BR-15) =====
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')), :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'the same request id is a replay');
select is(:'r1_again'::jsonb ->> 'batch_no', '2', 'the replay returns the same batch');
select is((select count(*)::int from public.order_batches where order_id = :'o1'), 2, 'no second batch was written');
select is(tests.outcome_as(:'cashier', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')), :'req1')),
  'REQUEST_ID_CONFLICT', 'another user cannot reuse the request id');

-- ===== G2: a kitchen add-on reopens a Ready order =====
update public.order_batches set status = 'ready', ready_at = now() where order_id = :'o1';
select private.sync_order_status(:'o1', :'chef', null);
select is((select status::text from public.orders where id = :'o1'), 'ready', 'fixture: the order is Ready');
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'tikka')))) as r3 \gset
select is(:'r3'::jsonb ->> 'status', 'accepted', 'a kitchen add-on moves a Ready order back to Accepted (G2)');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by, reason from public.order_status_history
            where order_id = %L order by id desc limit 1 $$, :'o1'),
  $$ values ('ready'::text, 'accepted'::text, null::uuid, 'Add-on batch 3'::text) $$,
  'the history records a system change with the batch number'
);

-- ===== BR-07: a drinks-only add-on never reaches the kitchen =====
update public.order_batches set status = 'served', served_at = now() where order_id = :'o1';
select private.sync_order_status(:'o1', :'waiter', null);
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'water', 2)))) as r4 \gset
select is((select status::text from public.order_batches where order_id = :'o1' and batch_no = 4), 'served',
  'a drinks-only add-on to a Served order is Served at once (never in the kitchen)');
select is(:'r4'::jsonb ->> 'status', 'served', 'and the order stays Served');

update public.order_batches set status = 'ready' where order_id = :'o1' and batch_no = 4;
select private.sync_order_status(:'o1', null, null);
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'water')))) as r5 \gset
select is((select status::text from public.order_batches where order_id = :'o1' and batch_no = 5), 'ready',
  'a drinks-only add-on to a Ready order is Ready at once');
select is(:'r5'::jsonb ->> 'status', 'ready', 'and the order stays Ready');

-- ===== A pending bill request is cleared =====
update public.orders set bill_requested = true, bill_requested_at = now() where id = :'o1';
update public.restaurant_tables set status = 'bill_requested' where id = :'t1';
select tests.call_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))) as r6 \gset
select is(:'r6'::jsonb ->> 'bill_requested', 'false', 'adding items clears the bill request (the bill changed)');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'occupied', 'the table is Occupied again');

-- ===== Rules =====
select is(tests.outcome_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'sold_out')))),
  'ITEM_UNAVAILABLE', 'a sold-out item is rejected (BR-13)');
select is(tests.outcome_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan') || '{"price": 1}'))),
  'ITEM_FIELD_NOT_ALLOWED', 'a client price is rejected (BR-01)');
select is(tests.outcome_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan', 0)))),
  'QUANTITY_INVALID', 'quantity 0 is rejected');
select is(tests.outcome_as(:'waiter', tests.add(:'o1', '[]')), 'ITEMS_REQUIRED', 'an empty list is rejected');
select is(tests.outcome_as(:'waiter', tests.add(gen_random_uuid(), jsonb_build_array(tests.line(:'naan')))),
  'ORDER_NOT_FOUND', 'an unknown order is rejected');
select is(tests.outcome_as(:'waiter', format($$ select public.add_items_to_order(null, %L, %L) $$, :'o1', jsonb_build_array(tests.line(:'naan')))),
  'REQUEST_ID_REQUIRED', 'a request id is required');

-- Nothing written when one line is bad (all or nothing).
select count(*) as batches_before from public.order_batches where order_id = :'o1' \gset
select is(tests.outcome_as(:'cashier', tests.add(:'o1', jsonb_build_array(tests.line(:'naan'), tests.line(:'sold_out')))),
  'ITEM_UNAVAILABLE', 'a list with one sold-out item is rejected');
select is((select count(*) from public.order_batches where order_id = :'o1'), :'batches_before'::bigint,
  'nothing was written');

-- Paid and closed orders.
update public.orders set payment_status = 'paid' where id = :'o1';
select is(tests.outcome_as(:'cashier', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))),
  'ORDER_ALREADY_PAID', 'a paid order takes no new items');
update public.orders set payment_status = 'unpaid' where id = :'o1';
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'naan')) ->> 'order_id' as o2 \gset
update public.orders set status = 'cancelled', cancel_reason = 'test', cancelled_at = now() where id = :'o2';
select is(tests.outcome_as(:'cashier', tests.add(:'o2', jsonb_build_array(tests.line(:'naan')))),
  'ORDER_CLOSED', 'a cancelled order takes no new items');
update public.orders set status = 'pending', cancel_reason = null, cancelled_at = null where id = :'o2';
select is(tests.outcome_as(:'cashier', tests.add(:'o2', jsonb_build_array(tests.line(:'naan')))),
  'ORDER_STATUS_INVALID', 'a Pending (online, P2) order takes no new items');

-- ===== Roles (spec 4: Admin, Cashier, Waiter own) =====
select is(tests.outcome_as(:'admin', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'ok', 'admin may add items');
select is(tests.outcome_as(:'cashier', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'ok', 'cashier may add items');
select is(tests.outcome_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'ok', 'the owning waiter may add items');
select is(tests.outcome_as(:'waiter2', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'NOT_AUTHORIZED', 'another waiter may not');
select is(tests.outcome_as(:'chef', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'NOT_AUTHORIZED', 'deactivated staff may not');
select is(tests.outcome_as(null, tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'PERMISSION_DENIED', 'anon may not');

-- A deactivated waiter loses even own orders.
update public.profiles set is_active = false where id = :'waiter';
select is(tests.outcome_as(:'waiter', tests.add(:'o1', jsonb_build_array(tests.line(:'naan')))), 'NOT_AUTHORIZED',
  'a waiter deactivated mid-shift can no longer add to own orders');

select * from finish();
rollback;

-- remove_or_cancel_item (S1): cancel a sent line with a reason (BR-09), totals recalculated
-- (BR-16), empty batches cancelled, the order status follows (BR-08), the last line cancels
-- the order, idempotency, roles. Demo rates: tax 16%, service charge 5% on Dine-In.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(31);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

select tests.create_staff('rc.admin', 'admin') as admin \gset
select tests.create_staff('rc.cashier', 'cashier') as cashier \gset
select tests.create_staff('rc.waiter', 'waiter') as waiter \gset
select tests.create_staff('rc.chef', 'chef') as chef \gset
select tests.create_staff('rc.rider', 'rider') as rider \gset
select tests.create_staff('rc.former', 'cashier') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(961) as t1 \gset
select tests.create_table(962) as t2 \gset
select tests.create_item('RI Tikka', 60000) as tikka \gset
select tests.create_item('RI Naan', 30000) as naan \gset
select tests.create_item('RI Water', 8000, false) as water \gset

create function tests.cancel_item(p_item uuid, p_reason text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.remove_or_cancel_item(%L, %L, %L) $f$, p_request, p_item, p_reason)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 2), tests.line(%L))) $$,
  :'t1', :'tikka', :'water')) ->> 'order_id' as o1 \gset
select id as tikka_line from public.order_items where order_id = :'o1' and menu_item_id = :'tikka' \gset
select id as water_line from public.order_items where order_id = :'o1' and menu_item_id = :'water' \gset
-- 2 x 600 + 80 = 1,280; service 64; tax 204.80; total 1,548.80
select is((select total from public.orders where id = :'o1'), 154880::bigint, 'fixture: total Rs 1,548.80');

-- ===== Cancel one line =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'cashier', tests.cancel_item(:'water_line', 'Customer changed mind', :'req1')) as r1 \gset
select results_eq(
  format($$ select is_cancelled, cancel_reason, cancelled_by, cancelled_at is not null from public.order_items where id = %L $$, :'water_line'),
  format($$ values (true, 'Customer changed mind'::text, %L::uuid, true) $$, :'cashier'),
  'the line is cancelled with reason, who and when (never deleted)'
);
-- 1,200; service 60; tax 192; total 1,452
select results_eq(
  format($$ select subtotal, service_charge, tax, total from public.orders where id = %L $$, :'o1'),
  $$ values (120000::bigint, 6000::bigint, 19200::bigint, 145200::bigint) $$,
  'totals are recalculated without the cancelled line (Rs 1,452)'
);
select is(:'r1'::jsonb ->> 'total', '145200', 'the result carries the new total');
select is(:'r1'::jsonb ->> 'order_item_id', :'water_line', 'the result names the line');
select is((select status::text from public.order_batches where order_id = :'o1' and batch_no = 1), 'sent',
  'a batch with live lines stays in the kitchen');
select is(:'r1'::jsonb ->> 'status', 'accepted', 'the order stays Accepted');

-- Idempotency (BR-15)
select tests.call_as(:'cashier', tests.cancel_item(:'water_line', 'Customer changed mind', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'water_line', 'Other', :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with another reason is a conflict');
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'water_line', 'Again')), 'ITEM_ALREADY_CANCELLED',
  'a cancelled line cannot be cancelled again');

-- ===== Cancelling the only add-on line: batch cancelled, order Ready again =====
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'preparing') $$,
  (select id from public.order_batches where order_id = :'o1' and batch_no = 1))) as p1 \gset
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'ready') $$,
  (select id from public.order_batches where order_id = :'o1' and batch_no = 1))) as p2 \gset
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'naan')) as added \gset
select is(:'added'::jsonb ->> 'status', 'accepted', 'fixture: the add-on reopened the Ready order');
select id as naan_line from public.order_items where order_id = :'o1' and menu_item_id = :'naan' \gset
select tests.call_as(:'cashier', tests.cancel_item(:'naan_line', 'Kitchen out of dough')) as r2 \gset
select is((select status::text from public.order_batches where order_id = :'o1' and batch_no = 2), 'cancelled',
  'the empty add-on batch is cancelled (the kitchen drops it)');
select is(:'r2'::jsonb ->> 'status', 'ready', 'the order is Ready again: its remaining batch is Ready (BR-08)');
select is((select reason from public.order_status_history where order_id = :'o1' order by id desc limit 1),
  'Item cancelled: Kitchen out of dough', 'the history says why the status changed');

-- A discount is capped at the new subtotal.
update public.orders set discount = 120000, discount_reason = 'Fixture' where id = :'o1';
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'water')) as added2 \gset
select id as water2 from public.order_items where order_id = :'o1' and batch_no = 3 \gset
select tests.call_as(:'cashier', tests.cancel_item(:'tikka_line', 'Burnt')) as r3 \gset
select results_eq(
  format($$ select subtotal, discount from public.orders where id = %L $$, :'o1'),
  $$ values (8000::bigint, 8000::bigint) $$,
  'a discount above the new subtotal is capped by calc_order_totals'
);

-- ===== The last live line cancels the order =====
select tests.call_as(:'cashier', tests.cancel_item(:'water2', 'Customer left')) as r4 \gset
select is(:'r4'::jsonb ->> 'status', 'cancelled', 'cancelling the last line cancels the order');
select is((select cancel_reason from public.orders where id = :'o1'), 'Customer left', 'with the same reason');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'available', 'and frees the table');
select is(:'r4'::jsonb ->> 'subtotal', '0', 'nothing is left on the bill');

-- ===== Rules =====
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'t2', :'tikka', :'naan')) ->> 'order_id' as o2 \gset
select id as line2 from public.order_items where order_id = :'o2' and menu_item_id = :'tikka' \gset
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'line2', null)), 'REASON_REQUIRED', 'a reason is required (BR-09)');
select is(tests.outcome_as(:'cashier', tests.cancel_item(gen_random_uuid(), 'x')), 'ITEM_NOT_FOUND', 'an unknown line');
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'water_line', 'x')), 'ORDER_CLOSED', 'a line of a cancelled order');
update public.orders set payment_status = 'paid' where id = :'o2';
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'line2', 'x')), 'ORDER_ALREADY_PAID', 'a paid order (void first)');
update public.orders set payment_status = 'unpaid' where id = :'o2';

-- ===== Roles (spec 4: after send only Cashier and Admin, BR-09) =====
select is(tests.outcome_as(:'admin', tests.cancel_item(:'line2', 'x')), 'ok', 'admin may cancel a line');
select is(tests.outcome_as(:'cashier', tests.cancel_item(:'line2', 'x')), 'ok', 'cashier may cancel a line');
select is(tests.outcome_as(:'waiter', tests.cancel_item(:'line2', 'x')), 'NOT_AUTHORIZED', 'the owning waiter may not (the line was sent)');
select is(tests.outcome_as(:'chef', tests.cancel_item(:'line2', 'x')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.cancel_item(:'line2', 'x')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.cancel_item(:'line2', 'x')), 'NOT_AUTHORIZED', 'deactivated cashier may not');
select is(tests.outcome_as(null, tests.cancel_item(:'line2', 'x')), 'PERMISSION_DENIED', 'anon may not');
select is((select is_cancelled from public.order_items where id = :'line2'), false, 'the role checks changed nothing');

select * from finish();
rollback;

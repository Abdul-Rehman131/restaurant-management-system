-- set_batch_status (S1): Sent -> Preparing -> Ready per batch, the order status derived from
-- all batches (BR-08, G3), forbidden transitions, idempotency, roles (spec 4: Preparing and
-- Ready by Admin, Cashier, Chef).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(29);

select tests.create_staff('bs.admin', 'admin') as admin \gset
select tests.create_staff('bs.cashier', 'cashier') as cashier \gset
select tests.create_staff('bs.waiter', 'waiter') as waiter \gset
select tests.create_staff('bs.chef', 'chef') as chef \gset
select tests.create_staff('bs.rider', 'rider') as rider \gset
select tests.create_staff('bs.former', 'chef') as former \gset
update public.profiles set is_active = false where id = :'former';

select tests.create_table(811) as t1 \gset
select tests.create_item('BS Tikka', 60000) as tikka \gset
select tests.create_item('BS Water', 8000, false) as water \gset

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset
select id as b1 from public.order_batches where order_id = :'o1' and batch_no = 1 \gset

create function tests.batch(p_batch uuid, p_status text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.set_batch_status(%L, %L, %L) $f$, p_request, p_batch, p_status)
$$;

-- ===== Sent -> Preparing -> Ready =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'chef', tests.batch(:'b1', 'preparing', :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'batch_status', 'preparing', 'the chef marks the batch Preparing');
select is(:'r1'::jsonb ->> 'order_status', 'preparing', 'the order becomes Preparing');
select ok((select preparing_at is not null from public.order_batches where id = :'b1'), 'the batch preparing time is set');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.order_status_history
            where order_id = %L order by id desc limit 1 $$, :'o1'),
  format($$ values ('accepted'::text, 'preparing'::text, %L::uuid) $$, :'chef'),
  'the history records the chef'
);

-- Idempotency (BR-15)
select tests.call_as(:'chef', tests.batch(:'b1', 'preparing', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'the same request id is a replay (a double tap is harmless)');
select is((select count(*)::int from public.order_status_history where order_id = :'o1' and to_status = 'preparing'), 1,
  'no second history row');
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'ready', :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with another status is a conflict, not a replay');

select tests.call_as(:'chef', tests.batch(:'b1', 'ready')) as r2 \gset
select is(:'r2'::jsonb ->> 'order_status', 'ready', 'all batches Ready makes the order Ready (BR-08)');
select ok((select ready_at is not null from public.orders where id = :'o1'), 'the order ready time is set');

-- ===== Forbidden transitions =====
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'preparing')), 'BATCH_TRANSITION_NOT_ALLOWED', 'Ready -> Preparing is not allowed');
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'ready')), 'BATCH_TRANSITION_NOT_ALLOWED', 'Ready -> Ready is not allowed');
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'served')), 'BATCH_STATUS_INVALID', 'Served is not a kitchen status');
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'cancelled')), 'BATCH_STATUS_INVALID', 'Cancelled is not a kitchen status');
select is(tests.outcome_as(:'chef', tests.batch(:'b1', 'sent')), 'BATCH_STATUS_INVALID', 'Sent cannot be set');
select is(tests.outcome_as(:'chef', tests.batch(gen_random_uuid(), 'ready')), 'BATCH_NOT_FOUND', 'an unknown batch is rejected');

-- ===== BR-08 with an ADD-ON: Ready only when every batch is Ready =====
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'tikka')) as add2 \gset
select id as b2 from public.order_batches where order_id = :'o1' and batch_no = 2 \gset
select is((select status::text from public.orders where id = :'o1'), 'accepted', 'the add-on reopened the order (G2)');
select is(tests.outcome_as(:'chef', tests.batch(:'b2', 'ready')), 'BATCH_TRANSITION_NOT_ALLOWED', 'Sent -> Ready skips Preparing: not allowed');
select tests.call_as(:'chef', tests.batch(:'b2', 'preparing')) as r3 \gset
select is(:'r3'::jsonb ->> 'order_status', 'preparing', 'batch 1 Ready + batch 2 Preparing: the order is Preparing');
select tests.call_as(:'chef', tests.batch(:'b2', 'ready')) as r4 \gset
select is(:'r4'::jsonb ->> 'order_status', 'ready', 'both batches Ready: the order is Ready again');
select is((:'r4'::jsonb ->> 'batch_no')::int, 2, 'the result names the batch number');

-- A drinks-only order is Ready at once and has no kitchen batch to mark (BR-07, BR-08).
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'water')) ->> 'order_id' as o2 \gset
select id as b3 from public.order_batches where order_id = :'o2' \gset
select is(tests.outcome_as(:'chef', tests.batch(:'b3', 'preparing')), 'BATCH_TRANSITION_NOT_ALLOWED',
  'a drinks-only batch is already Ready');

-- Closed orders
update public.orders set status = 'cancelled', cancel_reason = 'test', cancelled_at = now() where id = :'o2';
update public.order_batches set status = 'sent' where id = :'b3';
select is(tests.outcome_as(:'chef', tests.batch(:'b3', 'preparing')), 'ORDER_CLOSED', 'a cancelled order cannot change');

-- ===== Roles =====
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'tikka')) as add3 \gset
select id as b4 from public.order_batches where order_id = :'o1' and batch_no = 3 \gset
select is(tests.outcome_as(:'admin', tests.batch(:'b4', 'preparing')), 'ok', 'admin may mark Preparing');
select is(tests.outcome_as(:'cashier', tests.batch(:'b4', 'preparing')), 'ok', 'cashier may mark Preparing');
select is(tests.outcome_as(:'chef', tests.batch(:'b4', 'preparing')), 'ok', 'chef may mark Preparing');
select is(tests.outcome_as(:'waiter', tests.batch(:'b4', 'preparing')), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'rider', tests.batch(:'b4', 'preparing')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.batch(:'b4', 'preparing')), 'NOT_AUTHORIZED', 'deactivated chef may not');
select is(tests.outcome_as(null, tests.batch(:'b4', 'preparing')), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

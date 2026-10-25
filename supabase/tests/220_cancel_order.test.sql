-- cancel_order (S1): Cashier or Admin, reason required (BR-09), only before Ready and before
-- payment, batches cancelled, table freed (BR-05), idempotency, roles.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

select tests.create_staff('cx.admin', 'admin') as admin \gset
select tests.create_staff('cx.cashier', 'cashier') as cashier \gset
select tests.create_staff('cx.waiter', 'waiter') as waiter \gset
select tests.create_staff('cx.chef', 'chef') as chef \gset
select tests.create_staff('cx.rider', 'rider') as rider \gset
select tests.create_staff('cx.former', 'cashier') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(931) as t1 \gset
select tests.create_table(932) as t2 \gset
select tests.create_item('CX Tikka', 60000) as tikka \gset

create function tests.cancel(p_order uuid, p_reason text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.cancel_order(%L, %L, %L) $f$, p_request, p_order, p_reason)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'t1', :'tikka', :'tikka')) ->> 'order_id' as o1 \gset
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'tikka')) as added \gset

-- ===== Cancel =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'cashier', tests.cancel(:'o1', 'Wrong table', :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'status', 'cancelled', 'the cashier cancels the order');
select results_eq(
  format($$ select cancel_reason, cancelled_by, cancelled_at is not null from public.orders where id = %L $$, :'o1'),
  format($$ values ('Wrong table'::text, %L::uuid, true) $$, :'cashier'),
  'the reason, who and when are stored'
);
select is((select count(*)::int from public.order_batches where order_id = :'o1' and status = 'cancelled'), 2,
  'both batches (first send and ADD-ON) are cancelled');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'available', 'the table is Available again');
select is(
  tests.outcome_as(:'waiter', format(
    $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t1', :'tikka')),
  'ok', 'a new order can open on the freed table (BR-05)'
);
select is((select reason from public.order_status_history where order_id = :'o1' and to_status = 'cancelled'), 'Wrong table',
  'the history records the reason');

-- Idempotency (BR-15)
select tests.call_as(:'cashier', tests.cancel(:'o1', 'Wrong table', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a retry is a replay');
select is((select count(*)::int from public.order_status_history where order_id = :'o1' and to_status = 'cancelled'), 1,
  'one cancellation in the history');
select is(tests.outcome_as(:'cashier', tests.cancel(:'o1', 'Other reason', :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with another reason is a conflict');
select is(tests.outcome_as(:'cashier', tests.cancel(:'o1', 'Again')), 'ORDER_CLOSED', 'a cancelled order cannot be cancelled again');

-- ===== Rules =====
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t2', :'tikka')) ->> 'order_id' as o2 \gset
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', null)), 'REASON_REQUIRED', 'a reason is required (BR-09)');
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', '  ')), 'REASON_REQUIRED', 'a blank reason is rejected');
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', repeat('x', 301))), 'REASON_TOO_LONG', 'a reason over 300 characters is rejected');
select is(tests.outcome_as(:'cashier', tests.cancel(gen_random_uuid(), 'x')), 'ORDER_NOT_FOUND', 'an unknown order');
update public.orders set payment_status = 'paid' where id = :'o2';
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', 'x')), 'ORDER_ALREADY_PAID', 'a paid order cannot be cancelled (void first)');
update public.orders set payment_status = 'unpaid', status = 'ready' where id = :'o2';
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', 'x')), 'ORDER_CANNOT_BE_CANCELLED', 'a Ready order cannot be cancelled (spec 6.4)');
update public.orders set status = 'preparing' where id = :'o2';

-- ===== Roles (spec 4: Cashier and Admin only) =====
select is(tests.outcome_as(:'admin', tests.cancel(:'o2', 'x')), 'ok', 'admin may cancel');
select is(tests.outcome_as(:'cashier', tests.cancel(:'o2', 'x')), 'ok', 'cashier may cancel');
select is(tests.outcome_as(:'waiter', tests.cancel(:'o2', 'x')), 'NOT_AUTHORIZED', 'the owning waiter may not (BR-09)');
select is(tests.outcome_as(:'chef', tests.cancel(:'o2', 'x')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.cancel(:'o2', 'x')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.cancel(:'o2', 'x')), 'NOT_AUTHORIZED', 'deactivated cashier may not');
select is(tests.outcome_as(null, tests.cancel(:'o2', 'x')), 'PERMISSION_DENIED', 'anon may not');
select is((select status::text from public.orders where id = :'o2'), 'preparing', 'nothing above changed the order (all rolled back)');

select * from finish();
rollback;

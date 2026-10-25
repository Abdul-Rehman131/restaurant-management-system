-- request_bill (S1): flag and table status, no-op on repeat, paid and closed orders,
-- idempotency, roles (spec 4: Admin, Cashier, Waiter own).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(21);

select tests.create_staff('rb.admin', 'admin') as admin \gset
select tests.create_staff('rb.cashier', 'cashier') as cashier \gset
select tests.create_staff('rb.waiter', 'waiter') as waiter \gset
select tests.create_staff('rb.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('rb.chef', 'chef') as chef \gset
select tests.create_staff('rb.rider', 'rider') as rider \gset
select tests.create_staff('rb.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(941) as t1 \gset
select tests.create_item('RB Tikka', 60000) as tikka \gset

create function tests.bill(p_order uuid, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.request_bill(%L, %L) $f$, p_request, p_order)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset

-- ===== Request the bill =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'waiter', tests.bill(:'o1', :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'bill_requested', 'true', 'the waiter requests the bill');
select ok((select bill_requested_at is not null from public.orders where id = :'o1'), 'the request time is stored');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'bill_requested', 'the table shows Bill Requested');
select is(:'r1'::jsonb ->> 'status', 'accepted', 'the order status does not change (a flag, not a status)');
select bill_requested_at as first_at from public.orders where id = :'o1' \gset

select tests.call_as(:'waiter', tests.bill(:'o1', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a double tap is a replay (BR-15)');
select tests.call_as(:'cashier', tests.bill(:'o1')) as r2 \gset
select is(:'r2'::jsonb ->> 'bill_requested', 'true', 'asking again with a new request id is a no-op');
select is((select bill_requested_at from public.orders where id = :'o1'), :'first_at'::timestamptz,
  'and keeps the first request time (the cashier list order)');

-- ===== Rules =====
select is(tests.outcome_as(:'waiter', tests.bill(gen_random_uuid())), 'ORDER_NOT_FOUND', 'an unknown order');
select is(tests.outcome_as(:'waiter', format($$ select public.request_bill(null, %L) $$, :'o1')), 'REQUEST_ID_REQUIRED', 'a request id is required');
update public.orders set payment_status = 'paid' where id = :'o1';
select is(tests.outcome_as(:'waiter', tests.bill(:'o1')), 'ORDER_ALREADY_PAID', 'a paid order needs no bill');
update public.orders set payment_status = 'unpaid', status = 'pending' where id = :'o1';
select is(tests.outcome_as(:'cashier', tests.bill(:'o1')), 'ORDER_STATUS_INVALID', 'a Pending order has no bill yet');
update public.orders set status = 'cancelled', cancel_reason = 'x', cancelled_at = now() where id = :'o1';
select is(tests.outcome_as(:'cashier', tests.bill(:'o1')), 'ORDER_CLOSED', 'a closed order has no bill');
update public.orders set status = 'served', cancel_reason = null, cancelled_at = null,
                         bill_requested = false, bill_requested_at = null where id = :'o1';

-- ===== Roles =====
select is(tests.outcome_as(:'admin', tests.bill(:'o1')), 'ok', 'admin may request the bill');
select is(tests.outcome_as(:'cashier', tests.bill(:'o1')), 'ok', 'cashier may request the bill');
select is(tests.outcome_as(:'waiter', tests.bill(:'o1')), 'ok', 'the owning waiter may request the bill');
select is(tests.outcome_as(:'waiter2', tests.bill(:'o1')), 'NOT_AUTHORIZED', 'another waiter may not');
select is(tests.outcome_as(:'chef', tests.bill(:'o1')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.bill(:'o1')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.bill(:'o1')), 'NOT_AUTHORIZED', 'deactivated staff may not');
select is(tests.outcome_as(null, tests.bill(:'o1')), 'PERMISSION_DENIED', 'anon may not');

-- A Take Away order can have its bill requested too; there is no table to flag.
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o2 \gset
select is(tests.call_as(:'cashier', tests.bill(:'o2')) ->> 'bill_requested', 'true', 'a Take Away bill request sets the flag only');

select * from finish();
rollback;

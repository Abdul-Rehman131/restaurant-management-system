-- void_payment (S1): Admin only, reason, once (G8); Unpaid again, a Completed order reopens
-- (BR-12) and can be paid again; a busy table blocks the reopen (BR-05); idempotency, roles.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(28);

-- Amounts below assume no tax or service charge (the local seed sets demo rates).
update public.settings set tax_bps = 0, service_charge_bps = 0;

select tests.create_staff('vp.admin', 'admin') as admin \gset
select tests.create_staff('vp.cashier', 'cashier') as cashier \gset
select tests.create_staff('vp.waiter', 'waiter') as waiter \gset
select tests.create_staff('vp.chef', 'chef') as chef \gset
select tests.create_staff('vp.rider', 'rider') as rider \gset
select tests.create_staff('vp.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(981) as t1 \gset
select tests.create_table(982) as t2 \gset
select tests.create_item('VP Water', 10000, false) as water \gset

create function tests.void(p_payment uuid, p_reason text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.void_payment(%L, %L, %L) $f$, p_request, p_payment, p_reason)
$$;
-- A Dine-In drinks order (Ready at once), served by the waiter.
create function tests.served_order(p_table uuid) returns uuid language plpgsql as $$
declare
  v_order uuid;
begin
  v_order := tests.call_as((select id from public.profiles where username = 'vp.waiter'), format(
    $f$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 3))) $f$,
    p_table, (select id from public.menu_items where name = 'VP Water'))) ->> 'order_id';
  perform tests.call_as((select id from public.profiles where username = 'vp.waiter'), format(
    $f$ select public.set_order_status(gen_random_uuid(), %L, 'served') $f$, v_order));
  return v_order;
end;
$$;

-- ===== Split payment, then void the card part =====
select tests.served_order(:'t1') as o1 \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 20000}, {"method": "card", "amount": 10000}]') $$,
  :'o1')) as paid1 \gset
select is(:'paid1'::jsonb ->> 'status', 'completed', 'fixture: paid and Completed, table Available');
select id as card_payment from public.payments where order_id = :'o1' and method = 'card' \gset

select gen_random_uuid() as req1 \gset
select tests.call_as(:'admin', tests.void(:'card_payment', 'Card terminal declined later', :'req1')) as r1 \gset
select results_eq(
  format($$ select voided_by, void_reason, voided_at is not null from public.payments where id = %L $$, :'card_payment'),
  format($$ values (%L::uuid, 'Card terminal declined later'::text, true) $$, :'admin'),
  'the payment is voided with who, why and when (never deleted)'
);
select is(:'r1'::jsonb ->> 'payment_status', 'unpaid', 'the order is Unpaid again');
select is((:'r1'::jsonb ->> 'paid')::bigint, 20000::bigint, 'only the cash part still counts');
select is(:'r1'::jsonb ->> 'status', 'served', 'a Completed Dine-In order reopens as Served (BR-12)');
select is(:'r1'::jsonb ->> 'payment_id', :'card_payment', 'the result names the payment');
select results_eq(
  format($$ select bill_requested, completed_at is null from public.orders where id = %L $$, :'o1'),
  $$ values (true, true) $$,
  'the bill is requested again and completed_at is cleared'
);
select is((select status::text from public.restaurant_tables where id = :'t1'), 'bill_requested', 'the table shows Bill Requested');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by, reason from public.order_status_history
            where order_id = %L order by id desc limit 1 $$, :'o1'),
  format($$ values ('completed'::text, 'served'::text, %L::uuid, 'Payment voided: Card terminal declined later'::text) $$, :'admin'),
  'the history records the reopen and why'
);

-- Idempotency (BR-15) and once only.
select tests.call_as(:'admin', tests.void(:'card_payment', 'Card terminal declined later', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.outcome_as(:'admin', tests.void(:'card_payment', 'Again')), 'PAYMENT_ALREADY_VOIDED', 'a payment is voided once only');

-- Pay the remainder: Completed again.
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 10000, "tendered": 10000}]') $$, :'o1')) as paid2 \gset
select is(:'paid2'::jsonb ->> 'status', 'completed', 'the remaining amount is paid and the order is Completed again');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'available', 'the table is Available again');
select is((select count(*)::int from public.payments where order_id = :'o1' and voided_at is null), 2, 'two live payments, one voided row kept');

-- ===== Take Away reopens as Ready =====
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'water')) ->> 'order_id' as o2 \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "card", "amount": 10000}]') $$, :'o2')) as paid3 \gset
select id as p3 from public.payments where order_id = :'o2' \gset
select tests.call_as(:'admin', tests.void(:'p3', 'Wrong method')) as r3 \gset
select results_eq(
  format($$ select status::text, payment_status::text, bill_requested from public.orders where id = %L $$, :'o2'),
  $$ values ('ready'::text, 'unpaid'::text, false) $$,
  'a Completed Take Away order reopens as Ready and Unpaid'
);

-- ===== A paid order that is not Completed yet stays as it is =====
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t2', :'water')) ->> 'order_id' as o3 \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "card", "amount": 10000}]') $$, :'o3')) as paid4 \gset
select is(:'paid4'::jsonb ->> 'status', 'ready', 'fixture: paid before serving, still Ready');
select tests.call_as(:'admin', tests.void((select id from public.payments where order_id = :'o3'), 'Duplicate')) as r4 \gset
select results_eq(
  format($$ select status::text, payment_status::text from public.orders where id = %L $$, :'o3'),
  $$ values ('ready'::text, 'unpaid'::text) $$,
  'voiding before completion only makes the order Unpaid'
);

-- ===== A new order on the table blocks the reopen (BR-05) =====
update public.orders set status = 'cancelled', cancel_reason = 'x', cancelled_at = now() where id = :'o3';
select tests.served_order(:'t2') as o4 \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 30000}]') $$, :'o4')) as paid5 \gset
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t2', :'water')) as next_guest \gset
select is(tests.outcome_as(:'admin', tests.void((select id from public.payments where order_id = :'o4'), 'Late correction')),
  'TABLE_HAS_OPEN_ORDER', 'a void cannot reopen an order whose table is taken again');
select is((select count(*)::int from public.payments where order_id = :'o4' and voided_at is null), 1, 'nothing was voided');

-- ===== Rules and roles (G8: Admin only) =====
select id as live_payment from public.payments where order_id = :'o4' \gset
select is(tests.outcome_as(:'admin', tests.void(gen_random_uuid(), 'x')), 'PAYMENT_NOT_FOUND', 'an unknown payment');
select is(tests.outcome_as(:'admin', tests.void(:'live_payment', ' ')), 'REASON_REQUIRED', 'a reason is required');
select is(tests.outcome_as(:'admin', format($$ select public.void_payment(null, %L, 'x') $$, :'live_payment')), 'REQUEST_ID_REQUIRED', 'a request id is required');
select is(tests.outcome_as(:'cashier', tests.void(:'live_payment', 'x')), 'NOT_AUTHORIZED', 'cashier may not void');
select is(tests.outcome_as(:'waiter', tests.void(:'live_payment', 'x')), 'NOT_AUTHORIZED', 'waiter may not void');
select is(tests.outcome_as(:'chef', tests.void(:'live_payment', 'x')), 'NOT_AUTHORIZED', 'chef may not void');
select is(tests.outcome_as(:'rider', tests.void(:'live_payment', 'x')), 'NOT_AUTHORIZED', 'rider may not void');
select is(tests.outcome_as(:'former', tests.void(:'live_payment', 'x')), 'NOT_AUTHORIZED', 'deactivated admin may not void');
select is(tests.outcome_as(null, tests.void(:'live_payment', 'x')), 'PERMISSION_DENIED', 'anon may not void');

select * from finish();
rollback;

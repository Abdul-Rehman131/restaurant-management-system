-- Audit log triggers (S1, BR-24): every cancellation, discount, void, price change, table
-- move and waiter handover is recorded with user, time and reason, whichever path made it.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(18);

update public.settings set tax_bps = 0, service_charge_bps = 0;

select tests.create_staff('al.admin', 'admin') as admin \gset
select tests.create_staff('al.cashier', 'cashier') as cashier \gset
select tests.create_staff('al.waiter', 'waiter') as waiter \gset
select tests.create_staff('al.waiter2', 'waiter') as waiter2 \gset
select tests.create_table(941) as t1 \gset
select tests.create_table(942) as t2 \gset
select tests.create_item('AL Tikka', 60000) as tikka \gset
select tests.create_item('AL Water', 10000, false) as water \gset

-- The newest audit row for a target, as (action, user, reason, old, new).
create function tests.last_audit(p_target uuid) returns table (action text, user_id uuid, reason text, old_value jsonb, new_value jsonb)
language sql as $$
  select action, user_id, reason, old_value, new_value from public.audit_log
   where target_id = p_target::text order by id desc limit 1
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'t1', :'tikka', :'water')) ->> 'order_id' as o1 \gset
select is((select count(*)::int from public.audit_log where target_id = :'o1'), 0, 'creating an order is not an audit event');

-- ===== Line cancelled =====
select id as water_line from public.order_items where order_id = :'o1' and menu_item_id = :'water' \gset
select tests.call_as(:'cashier', format($$ select public.remove_or_cancel_item(gen_random_uuid(), %L, 'Spilled') $$, :'water_line')) as x \gset
select results_eq(
  format($$ select action, user_id, reason, old_value, new_value from tests.last_audit(%L) $$, :'water_line'),
  format($$ values ('order_item.cancelled'::text, %L::uuid, 'Spilled'::text,
           '{"name": "AL Water", "quantity": 1, "price": 10000, "line_total": 10000}'::jsonb,
           jsonb_build_object('order_id', %L::uuid, 'is_cancelled', true)) $$, :'cashier', :'o1'),
  'a cancelled line: who, why and the line snapshot'
);

-- ===== Discount applied and removed =====
select tests.call_as(:'admin', format($$ select public.apply_discount(gen_random_uuid(), %L, 10000, 'Birthday') $$, :'o1')) as x \gset
select results_eq(
  format($$ select action, user_id, reason, old_value, new_value from tests.last_audit(%L) $$, :'o1'),
  format($$ values ('order.discount_changed'::text, %L::uuid, 'Birthday'::text,
           '{"discount": 0}'::jsonb, '{"discount": 10000}'::jsonb) $$, :'admin'),
  'a discount: who, why, old and new amount (BR-10, BR-24)'
);
select tests.call_as(:'admin', format($$ select public.apply_discount(gen_random_uuid(), %L, 0, 'Applied by mistake') $$, :'o1')) as x \gset
select results_eq(
  format($$ select action, reason, new_value ->> 'discount' from tests.last_audit(%L) $$, :'o1'),
  $$ values ('order.discount_changed'::text, 'Applied by mistake'::text, '0'::text) $$,
  'removing a discount is audited with its reason'
);

-- ===== Table moved and waiter changed =====
select tests.call_as(:'cashier', format($$ select public.move_order_table(gen_random_uuid(), %L, %L, %L) $$, :'o1', :'t2', :'waiter2')) as x \gset
select results_eq(
  format($$ select action, user_id, old_value, new_value from public.audit_log
            where target_id = %L and action in ('order.table_moved', 'order.waiter_changed') order by action $$, :'o1'),
  format($$ values ('order.table_moved'::text, %L::uuid, jsonb_build_object('table_id', %L::uuid), jsonb_build_object('table_id', %L::uuid)),
                   ('order.waiter_changed', %L::uuid, jsonb_build_object('waiter_id', %L::uuid), jsonb_build_object('waiter_id', %L::uuid)) $$,
         :'cashier', :'t1', :'t2', :'cashier', :'waiter', :'waiter2'),
  'a move and a handover are both audited (ADR 002)'
);

-- ===== Order cancelled =====
select tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Customer left') $$, :'o1')) as x \gset
select results_eq(
  format($$ select action, user_id, reason, old_value ->> 'status', new_value ->> 'status' from tests.last_audit(%L) $$, :'o1'),
  format($$ values ('order.cancelled'::text, %L::uuid, 'Customer left'::text, 'accepted'::text, 'cancelled'::text) $$, :'cashier'),
  'a cancelled order: who, why, from which status (BR-24)'
);

-- The last-line path cancels the order too, and that is audited as well.
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o2 \gset
select tests.call_as(:'cashier', format($$ select public.remove_or_cancel_item(gen_random_uuid(), %L, 'Burnt') $$,
  (select id from public.order_items where order_id = :'o2'))) as x \gset
select is((select count(*)::int from public.audit_log where action = 'order.cancelled' and target_id = :'o2' and reason = 'Burnt'), 1,
  'cancelling the last line audits the order cancellation');
select is((select count(*)::int from public.audit_log where action = 'order_item.cancelled' and reason = 'Burnt'), 1,
  'and the line cancellation');

-- ===== Payment voided =====
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'water')) ->> 'order_id' as o3 \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "card", "amount": 10000}]') $$, :'o3')) as x \gset
select id as pay3 from public.payments where order_id = :'o3' \gset
select tests.call_as(:'admin', format($$ select public.void_payment(gen_random_uuid(), %L, 'Wrong card') $$, :'pay3')) as x \gset
select results_eq(
  format($$ select action, user_id, reason, old_value from tests.last_audit(%L) $$, :'pay3'),
  format($$ values ('payment.voided'::text, %L::uuid, 'Wrong card'::text,
           jsonb_build_object('order_id', %L::uuid, 'method', 'card', 'amount', 10000)) $$, :'admin', :'o3'),
  'a void: who, why, the method and amount (G8, BR-24)'
);

-- ===== Price changes (any path, even a direct update by the owner) =====
select tests.claims_as(:'admin');
update public.menu_items set price = 65000 where id = :'tikka';
select tests.logout();
select results_eq(
  format($$ select action, user_id, old_value, new_value from tests.last_audit(%L) $$, :'tikka'),
  format($$ values ('menu_item.price_changed'::text, %L::uuid, '{"price": 60000, "cost_price": 30000}'::jsonb,
           '{"price": 65000, "cost_price": 30000}'::jsonb) $$, :'admin'),
  'a price change is audited with old and new price (BR-24)'
);
update public.menu_items set cost_price = 31000 where id = :'tikka';
select results_eq(
  format($$ select action, user_id, new_value ->> 'cost_price' from tests.last_audit(%L) $$, :'tikka'),
  $$ values ('menu_item.price_changed'::text, null::uuid, '31000'::text) $$,
  'a cost change is audited too; without a caller the user is NULL (system)'
);
select count(*) as before_name from public.audit_log where target_id = :'tikka' \gset
update public.menu_items set name = 'AL Tikka Special' where id = :'tikka';
update public.menu_items set is_available = false where id = :'tikka';
select is((select count(*) from public.audit_log where target_id = :'tikka'), :'before_name'::bigint,
  'a name or availability change is not a price change');

-- ===== Nothing else is audited =====
select count(*) as before_flow from public.audit_log \gset
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t2', :'water')) ->> 'order_id' as o4 \gset
select tests.call_as(:'waiter', format($$ select public.request_bill(gen_random_uuid(), %L) $$, :'o4')) as x \gset
select tests.call_as(:'waiter', format($$ select public.set_order_status(gen_random_uuid(), %L, 'served') $$, :'o4')) as x \gset
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 10000}]') $$, :'o4')) as x \gset
select is((select count(*) from public.audit_log), :'before_flow'::bigint,
  'a normal order, bill, serve and payment writes no audit rows');

-- ===== The log is protected =====
select tests.login_as(:'admin');
select throws_ok($$ insert into public.audit_log (action, target_table, target_id) values ('fake.entry', 'orders', 'x') $$,
  '42501', null, 'even an admin cannot write the audit log directly');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'or delete from it');
select ok((select count(*) > 0 from public.audit_log), 'the admin can read it');
select tests.logout();
select tests.login_as(:'cashier');
select is((select count(*)::int from public.audit_log), 0, 'a cashier cannot read it');
select tests.logout();
select throws_ok($$ update public.audit_log set reason = 'edited' $$, 'P0001', null, 'and it is append-only even for the owner');

select * from finish();
rollback;

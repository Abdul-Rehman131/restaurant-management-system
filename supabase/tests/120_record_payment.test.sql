-- record_payment (T6): exact, split and over-tendered cash; all-or-nothing on mismatch;
-- completion only when fulfilled (BR-12); table release; idempotency; permissions.
-- Demo rates: tax 16%, service charge 5% on Dine-In only.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(36);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

select tests.create_staff('rp.admin', 'admin') as admin \gset
select tests.create_staff('rp.cashier', 'cashier') as cashier \gset
select tests.create_staff('rp.cashier2', 'cashier') as cashier2 \gset
select tests.create_staff('rp.waiter', 'waiter') as waiter \gset
select tests.create_staff('rp.chef', 'chef') as chef \gset
select tests.create_staff('rp.rider', 'rider') as rider \gset
select tests.create_table(401) as t1 \gset
select tests.create_table(402) as t2 \gset
select tests.create_item('RP Tikka', 60000) as tikka \gset
select tests.create_item('RP Water', 8000, false) as water \gset

-- Orders created through create_order, then moved to the state each case needs.
select tests.login_as(:'waiter');
-- A: Dine-In 2 x 600 = 1,200; service 60; tax 192; total 1,452
select public.create_order(gen_random_uuid(), 'dine_in', :'t1', null, null,
  jsonb_build_array(tests.line(:'tikka', 2))) ->> 'order_id' as order_a \gset
-- B: Dine-In 1 x 600; service 30; tax 96; total 726
select public.create_order(gen_random_uuid(), 'dine_in', :'t2', null, null,
  jsonb_build_array(tests.line(:'tikka', 1))) ->> 'order_id' as order_b \gset
select tests.logout();
select tests.login_as(:'cashier');
-- C: Take Away water only -> Ready at once; 80 + tax 12.80 = 92.80
select public.create_order(gen_random_uuid(), 'take_away', null, 'C', null,
  jsonb_build_array(tests.line(:'water', 1))) ->> 'order_id' as order_c \gset
-- D: Take Away kitchen item, still Accepted; 600 + tax 96 = 696
select public.create_order(gen_random_uuid(), 'take_away', null, 'D', null,
  jsonb_build_array(tests.line(:'tikka', 1))) ->> 'order_id' as order_d \gset
-- E: Take Away, cancelled before payment
select public.create_order(gen_random_uuid(), 'take_away', null, 'E', null,
  jsonb_build_array(tests.line(:'tikka', 1))) ->> 'order_id' as order_e \gset
select tests.logout();

update public.orders set status = 'served', served_at = now() where id = :'order_a';
update public.orders set status = 'cancelled', cancel_reason = 'Test', cancelled_at = now() where id = :'order_e';
select is((select total from public.orders where id = :'order_a'), 145200::bigint, 'fixture: order A total is Rs 1,452');

-- ===== Validation: nothing is written on any error =====
select tests.login_as(:'cashier');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 145199}]') $$, :'order_a'),
  'P0001', 'PAYMENT_MISMATCH', 'tenders below the total are rejected (BR-11)'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L,
            '[{"method": "cash", "amount": 100000}, {"method": "card", "amount": 45201}]') $$, :'order_a'),
  'P0001', 'PAYMENT_MISMATCH', 'a split that adds up to more than the total is rejected'
);
select tests.logout();
select is((select count(*)::int from public.payments where order_id = :'order_a'), 0, 'after a mismatch no payment row exists');
select is((select payment_status::text from public.orders where id = :'order_a'), 'unpaid', 'after a mismatch the order is still unpaid');

select tests.login_as(:'cashier');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 145200, "tendered": 100000}]') $$, :'order_a'),
  'P0001', 'TENDERED_INVALID', 'cash tendered below the amount is rejected'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "card", "amount": 145200, "tendered": 150000}]') $$, :'order_a'),
  'P0001', 'TENDERED_INVALID', 'tendered is only for cash'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 145200, "reference": "X1"}]') $$, :'order_a'),
  'P0001', 'REFERENCE_INVALID', 'a reference is only for card'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cheque", "amount": 145200}]') $$, :'order_a'),
  'P0001', 'TENDER_METHOD_INVALID', 'only cash and card are accepted (BR-11)'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 0}]') $$, :'order_a'),
  'P0001', 'TENDER_AMOUNT_INVALID', 'a zero amount is rejected'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1452.5}]') $$, :'order_a'),
  'P0001', 'TENDER_AMOUNT_INVALID', 'a fractional amount (not minor units) is rejected'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 145200, "total": 145200}]') $$, :'order_a'),
  'P0001', 'TENDER_FIELD_NOT_ALLOWED', 'unknown tender fields are rejected'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[]') $$, :'order_a'),
  'P0001', 'TENDERS_REQUIRED', 'at least one tender is required'
);
select throws_ok(
  $$ select public.record_payment(gen_random_uuid(), gen_random_uuid(), '[{"method": "cash", "amount": 1}]') $$,
  'P0001', 'ORDER_NOT_FOUND', 'an unknown order is rejected'
);
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 69600}]') $$, :'order_e'),
  'P0001', 'ORDER_CANCELLED', 'a cancelled order cannot be paid'
);

-- ===== A: exact total in cash with change; Served Dine-In -> Completed, table freed =====
select gen_random_uuid() as req_a \gset
select public.record_payment(:'req_a', :'order_a',
  '[{"method": "cash", "amount": 145200, "tendered": 150000}]') as pay_a \gset
select is(:'pay_a'::jsonb ->> 'payment_status', 'paid', 'A: the order is paid');
select is(:'pay_a'::jsonb ->> 'status', 'completed', 'A: a Served and paid Dine-In order is Completed (BR-12)');
select is((:'pay_a'::jsonb ->> 'change_due')::bigint, 4800::bigint, 'A: change due is returned (Rs 1,500 - Rs 1,452 = Rs 48)');
select is(:'pay_a'::jsonb ->> 'table_status', 'available', 'A: completing the order frees the table (BR-12)');

-- Idempotency
select public.record_payment(:'req_a', :'order_a',
  '[{"method": "cash", "amount": 145200, "tendered": 150000}]') as pay_a_again \gset
select is(:'pay_a_again'::jsonb ->> 'replayed', 'true', 'A: a retry with the same request id is a replay');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 145200}]') $$, :'order_a'),
  'P0001', 'ORDER_ALREADY_PAID', 'A: a second, different payment request is rejected'
);
select throws_ok(
  format($$ select public.record_payment(%L, %L, '[{"method": "cash", "amount": 72600}]') $$, :'req_a', :'order_b'),
  'P0001', 'REQUEST_ID_CONFLICT', 'a request id cannot be reused for another order'
);
select tests.logout();
select results_eq(
  format($$ select tender_no, method::text, amount, tendered, received_by from public.payments where order_id = %L $$, :'order_a'),
  format($$ values (1::smallint, 'cash'::text, 145200::bigint, 150000::bigint, %L::uuid) $$, :'cashier'),
  'A: exactly one tender row, with the tendered cash and the cashier, despite the retry'
);
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.order_status_history
            where order_id = %L and to_status = 'completed' $$, :'order_a'),
  format($$ values ('served'::text, 'completed'::text, %L::uuid) $$, :'cashier'),
  'A: history records Served -> Completed by the cashier'
);

-- ===== B: split cash + card on an Accepted (not yet served) Dine-In order =====
select tests.login_as(:'cashier');
select public.record_payment(gen_random_uuid(), :'order_b',
  '[{"method": "cash", "amount": 50000, "tendered": 50000}, {"method": "card", "amount": 22600, "reference": "TEST-0001"}]') as pay_b \gset
select tests.logout();
select is(:'pay_b'::jsonb ->> 'payment_status', 'paid', 'B: a cash + card split covering the total is accepted (BR-11)');
select is(:'pay_b'::jsonb ->> 'status', 'accepted', 'B: paid but not served stays open (BR-12)');
select is((select status::text from public.restaurant_tables where id = :'t2'), 'occupied', 'B: the table stays Occupied until the order is completed');
select results_eq(
  format($$ select tender_no, method::text, amount, reference from public.payments where order_id = %L order by tender_no $$, :'order_b'),
  $$ values (1::smallint, 'cash'::text, 50000::bigint, null::text), (2::smallint, 'card'::text, 22600::bigint, 'TEST-0001'::text) $$,
  'B: two tender rows in order, with the card reference'
);

-- ===== C: Take Away that is Ready -> Completed on payment; D: Accepted -> stays open =====
select tests.login_as(:'cashier');
select public.record_payment(gen_random_uuid(), :'order_c', '[{"method": "card", "amount": 9280}]') as pay_c \gset
select tests.logout();
select is(:'pay_c'::jsonb ->> 'status', 'completed', 'C: a Ready Take Away order is Completed when paid (spec 6.4)');

select tests.login_as(:'admin');
select public.record_payment(gen_random_uuid(), :'order_d', '[{"method": "cash", "amount": 69600}]') as pay_d \gset
select tests.logout();
select is(:'pay_d'::jsonb ->> 'payment_status', 'paid', 'D: an Admin can record a payment (BR-11)');
select is(:'pay_d'::jsonb ->> 'status', 'accepted', 'D: a Take Away paid before it is Ready stays open (G9)');

-- ===== Permissions =====
select tests.login_as(:'waiter');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1}]') $$, :'order_e'),
  '42501', 'NOT_AUTHORIZED', 'a waiter cannot record payments (BR-11)'
);
select tests.logout();
select tests.login_as(:'chef');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1}]') $$, :'order_e'),
  '42501', 'NOT_AUTHORIZED', 'a chef cannot record payments'
);
select tests.logout();
select tests.login_as(:'rider');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1}]') $$, :'order_e'),
  '42501', 'NOT_AUTHORIZED', 'a rider cannot record payments'
);
select tests.logout();
update public.profiles set is_active = false where id = :'cashier2';
select tests.login_as(:'cashier2');
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1}]') $$, :'order_e'),
  '42501', 'NOT_AUTHORIZED', 'a deactivated cashier is refused on the next request'
);
select tests.logout();
select tests.login_as_anon();
select throws_ok(
  format($$ select public.record_payment(gen_random_uuid(), %L, '[{"method": "cash", "amount": 1}]') $$, :'order_e'),
  '42501', null, 'anon cannot call record_payment'
);
select tests.logout();

select * from finish();
rollback;

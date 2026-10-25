-- Payments: amount > 0, tender rules, idempotency key, immutability and Admin-only void.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

select tests.create_staff('cashier.t', 'cashier') as cashier \gset
select tests.create_staff('admin.t', 'admin') as admin \gset
select tests.create_staff('waiter.t', 'waiter') as waiter \gset
select tests.create_order('take_away', null, 1) as o1 \gset
select gen_random_uuid() as req \gset

-- Amounts and tenders
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, received_by)
            values (%L, gen_random_uuid(), 1, 'cash', 0, %L) $$, :'o1', :'cashier'),
  '23514', null, 'amount 0 is rejected'
);
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, received_by)
            values (%L, gen_random_uuid(), 1, 'cash', -100, %L) $$, :'o1', :'cashier'),
  '23514', null, 'a negative amount is rejected'
);
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, tendered, received_by)
            values (%L, gen_random_uuid(), 1, 'cash', 5000, 4000, %L) $$, :'o1', :'cashier'),
  '23514', null, 'cash tendered below the amount is rejected'
);
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, tendered, received_by)
            values (%L, gen_random_uuid(), 1, 'card', 5000, 6000, %L) $$, :'o1', :'cashier'),
  '23514', null, 'tendered is only for cash'
);
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, reference, received_by)
            values (%L, gen_random_uuid(), 1, 'cash', 5000, 'REF1', %L) $$, :'o1', :'cashier'),
  '23514', null, 'a card reference is only for card'
);

-- BR-11: who can receive
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, received_by)
            values (%L, gen_random_uuid(), 1, 'cash', 5000, %L) $$, :'o1', :'waiter'),
  'P0001', 'PAYMENT_RECEIVER_NOT_ALLOWED', 'BR-11: a waiter cannot receive a payment'
);

-- A split payment (BR-11) under one request id
select lives_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, tendered, received_by)
            values (%1$L, %2$L, 1, 'cash', 3000, 5000, %3$L);
            insert into public.payments (order_id, request_id, tender_no, method, amount, reference, received_by)
            values (%1$L, %2$L, 2, 'card', 2000, 'TEST-0001', %3$L) $$, :'o1', :'req', :'cashier'),
  'a cash + card split is recorded under one request id'
);
select throws_ok(
  format($$ insert into public.payments (order_id, request_id, tender_no, method, amount, received_by)
            values (%L, %L, 1, 'cash', 3000, %L) $$, :'o1', :'req', :'cashier'),
  '23505', null, 'BR-15: the same request id and tender cannot be recorded twice'
);

-- Immutability
select throws_ok(
  format($$ update public.payments set amount = 1 where request_id = %L and tender_no = 1 $$, :'req'),
  'P0001', 'PAYMENT_IMMUTABLE', 'a payment amount cannot be edited'
);
select throws_ok(
  format($$ delete from public.payments where request_id = %L $$, :'req'),
  'P0001', null, 'payments cannot be deleted'
);

-- Void: Admin only, reason required, once
select throws_ok(
  format($$ update public.payments set voided_at = now(), voided_by = %L, void_reason = 'Wrong method'
            where request_id = %L and tender_no = 1 $$, :'cashier', :'req'),
  'P0001', 'VOID_REQUIRES_ADMIN', 'a cashier cannot void a payment'
);
select throws_ok(
  format($$ update public.payments set voided_at = now(), voided_by = %L
            where request_id = %L and tender_no = 1 $$, :'admin', :'req'),
  '23514', null, 'a void needs a reason (NULL reason is rejected)'
);
select throws_ok(
  format($$ update public.payments set voided_at = now(), voided_by = %L, void_reason = '   '
            where request_id = %L and tender_no = 1 $$, :'admin', :'req'),
  '23514', null, 'a void needs a non-blank reason'
);
select lives_ok(
  format($$ update public.payments set voided_at = now(), voided_by = %L, void_reason = 'Wrong method'
            where request_id = %L and tender_no = 1 $$, :'admin', :'req'),
  'an active Admin can void a payment with a reason'
);
select throws_ok(
  format($$ update public.payments set void_reason = 'Changed' where request_id = %L and tender_no = 1 $$, :'req'),
  'P0001', 'PAYMENT_ALREADY_VOIDED', 'a voided payment cannot be changed again'
);
select lives_ok(
  format($$ update public.profiles set is_active = false where id = %L $$, :'admin'),
  'the admin is deactivated'
);
select throws_ok(
  format($$ update public.payments set voided_at = now(), voided_by = %L, void_reason = 'Test'
            where request_id = %L and tender_no = 2 $$, :'admin', :'req'),
  'P0001', 'VOID_REQUIRES_ADMIN', 'a deactivated admin cannot void'
);

select * from finish();
rollback;

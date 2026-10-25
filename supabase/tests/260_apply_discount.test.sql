-- apply_discount (S1): Admin only (BR-10), reason required, totals via calc_order_totals
-- (the docs/pricing-rules.md worked example), limits, removal, idempotency, roles.
-- Demo rates: tax 16%, service charge 5% on Dine-In, discount reduces charges (G7).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

select tests.create_staff('dc.admin', 'admin') as admin \gset
select tests.create_staff('dc.cashier', 'cashier') as cashier \gset
select tests.create_staff('dc.waiter', 'waiter') as waiter \gset
select tests.create_staff('dc.chef', 'chef') as chef \gset
select tests.create_staff('dc.rider', 'rider') as rider \gset
select tests.create_staff('dc.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(971) as t1 \gset
select tests.create_item('DC Platter', 350000) as platter \gset

create function tests.discount(p_order uuid, p_amount bigint, p_reason text, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.apply_discount(%L, %L, %s, %L) $f$, p_request, p_order, coalesce(p_amount::text, 'null'), p_reason)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'platter')) ->> 'order_id' as o1 \gset
-- Rs 3,500; service 5% = 175; tax 16% = 560; total 4,235 (pricing-rules.md)
select is((select total from public.orders where id = :'o1'), 423500::bigint, 'fixture: Rs 3,500 Dine-In totals Rs 4,235');

-- ===== Discount =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'admin', tests.discount(:'o1', 50000, ' Regular guest ', :'req1')) as r1 \gset
-- Rs 500 off: base 3,000; service 150; tax 480; total 3,630 (pricing-rules.md worked example)
select results_eq(
  format($$ select subtotal, discount, service_charge, tax, total from public.orders where id = %L $$, :'o1'),
  $$ values (350000::bigint, 50000::bigint, 15000::bigint, 48000::bigint, 363000::bigint) $$,
  'a Rs 500 discount gives Rs 3,630, as in the pricing rules'
);
select is(:'r1'::jsonb ->> 'total', '363000', 'the result carries the new total');
select is((select discount_reason from public.orders where id = :'o1'), 'Regular guest', 'the reason is stored, trimmed (BR-10)');

-- Idempotency (BR-15)
select tests.call_as(:'admin', tests.discount(:'o1', 50000, ' Regular guest ', :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 60000, 'Regular guest', :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with another amount is a conflict');

-- The rule "discount reduces charges" is data, not code.
update public.settings set discount_reduces_charges = false;
select tests.call_as(:'admin', tests.discount(:'o1', 50000, 'Regular guest')) as r2 \gset
-- base stays 3,500: service 175, tax 560; total 3,000 + 175 + 560 = 3,735
select is(:'r2'::jsonb ->> 'total', '373500', 'with discount_reduces_charges off, charges stay on the full subtotal');
update public.settings set discount_reduces_charges = true;

-- The whole subtotal, then removal.
select is(tests.call_as(:'admin', tests.discount(:'o1', 350000, 'Complaint')) ->> 'total', '0',
  'a discount of the whole subtotal makes the bill zero');
select tests.call_as(:'admin', tests.discount(:'o1', 0, 'Discount given by mistake')) as r3 \gset
select is(:'r3'::jsonb ->> 'total', '423500', 'amount 0 removes the discount');
select is((select discount_reason from public.orders where id = :'o1'), 'Discount given by mistake', 'and keeps the reason for the removal');

-- ===== Rules =====
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 350001, 'x')), 'DISCOUNT_TOO_LARGE', 'not above the subtotal');
select is(tests.outcome_as(:'admin', tests.discount(:'o1', -1, 'x')), 'DISCOUNT_INVALID', 'not negative');
select is(tests.outcome_as(:'admin', tests.discount(:'o1', null, 'x')), 'DISCOUNT_INVALID', 'an amount is required');
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 100, null)), 'REASON_REQUIRED', 'a reason is required (BR-10)');
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 0, ' ')), 'REASON_REQUIRED', 'even to remove a discount');
select is(tests.outcome_as(:'admin', tests.discount(gen_random_uuid(), 100, 'x')), 'ORDER_NOT_FOUND', 'an unknown order');
update public.orders set payment_status = 'paid' where id = :'o1';
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 100, 'x')), 'ORDER_ALREADY_PAID', 'not on a paid order');
update public.orders set payment_status = 'unpaid' where id = :'o1';

-- ===== Roles (spec 4, BR-10: Admin only) =====
select is(tests.outcome_as(:'admin', tests.discount(:'o1', 100, 'x')), 'ok', 'admin may apply a discount');
select is(tests.outcome_as(:'cashier', tests.discount(:'o1', 100, 'x')), 'NOT_AUTHORIZED', 'cashier may not (BR-10)');
select is(tests.outcome_as(:'waiter', tests.discount(:'o1', 100, 'x')), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'chef', tests.discount(:'o1', 100, 'x')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.discount(:'o1', 100, 'x')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.discount(:'o1', 100, 'x')), 'NOT_AUTHORIZED', 'deactivated admin may not');
select is(tests.outcome_as(null, tests.discount(:'o1', 100, 'x')), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

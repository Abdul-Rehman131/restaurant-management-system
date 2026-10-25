-- RPC response contracts (ADR 002, condition 1). Each jsonb RPC's top-level keys must match
-- its Zod schema in packages/shared/src/schemas exactly. Change both together.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(7);

create function tests.keys(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_value) k
$$;

select tests.create_staff('rc.cashier', 'cashier') as cashier \gset
select tests.create_table(991) as t1 \gset
select tests.create_item('RC Water', 10000, false) as water \gset
select tests.create_item('RC Tikka', 60000) as tikka \gset
select tests.create_staff('rc.chef', 'chef') as chef \gset

-- orderSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'water')) as created \gset
select is(
  tests.keys(:'created'),
  array['bill_requested', 'business_date', 'discount', 'order_id', 'order_number', 'payment_status',
        'replayed', 'service_charge', 'status', 'subtotal', 'table_id', 'tax', 'total', 'type', 'waiter_id'],
  'create_order returns the orderSummary keys'
);

-- addItemsToOrderResponse (schemas/orders.ts): orderSummary + batch_no
select tests.call_as(:'cashier', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$,
  :'created'::jsonb ->> 'order_id', :'water')) as added \gset
select is(
  tests.keys(:'added'),
  array['batch_no', 'bill_requested', 'business_date', 'discount', 'order_id', 'order_number', 'payment_status',
        'replayed', 'service_charge', 'status', 'subtotal', 'table_id', 'tax', 'total', 'type', 'waiter_id'],
  'add_items_to_order returns orderSummary + batch_no'
);
-- (the bill changed: read the new total for the payment below)
select private.order_summary((:'created'::jsonb ->> 'order_id')::uuid, false) as created \gset

-- paymentSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('method', 'card', 'amount', %s))) $$,
  :'created'::jsonb ->> 'order_id', :'created'::jsonb ->> 'total')) as paid \gset
select is(
  tests.keys(:'paid'),
  array['change_due', 'order_id', 'order_number', 'paid', 'payment_status', 'replayed', 'status',
        'table_status', 'total'],
  'record_payment returns the paymentSummary keys'
);

-- setBatchStatusResponse (schemas/kitchen.ts)
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_kitchen \gset
select tests.call_as(:'chef', format(
  $$ select public.set_batch_status(gen_random_uuid(), %L, 'preparing') $$,
  (select id from public.order_batches where order_id = :'o_kitchen'))) as batch \gset
select is(
  tests.keys(:'batch'),
  array['batch_id', 'batch_no', 'batch_status', 'order_id', 'order_status', 'replayed'],
  'set_batch_status returns the setBatchStatusResponse keys'
);

-- setOrderStatusResponse = orderSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.set_order_status(gen_random_uuid(), %L, 'cancelled', 'Contract test') $$, :'o_kitchen')) as status_changed \gset
select is(tests.keys(:'status_changed'), tests.keys(:'created'), 'set_order_status returns the orderSummary keys');

-- cancelOrderResponse = orderSummary
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_cancel \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Contract test') $$, :'o_cancel'))),
  tests.keys(:'created'), 'cancel_order returns the orderSummary keys'
);

-- requestBillResponse = orderSummary
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_bill \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.request_bill(gen_random_uuid(), %L) $$, :'o_bill'))),
  tests.keys(:'created'), 'request_bill returns the orderSummary keys'
);

select * from finish();
rollback;

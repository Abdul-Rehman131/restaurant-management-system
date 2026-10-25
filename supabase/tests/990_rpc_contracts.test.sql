-- RPC response contracts (ADR 002, condition 1). Each jsonb RPC's top-level keys must match
-- its Zod schema in packages/shared/src/schemas exactly. Change both together.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(2);

create function tests.keys(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_value) k
$$;

select tests.create_staff('rc.cashier', 'cashier') as cashier \gset
select tests.create_table(991) as t1 \gset
select tests.create_item('RC Water', 10000, false) as water \gset

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

select * from finish();
rollback;

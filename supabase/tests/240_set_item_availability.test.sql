-- set_item_availability (S1): Sold Out and back (BR-13), existing orders unaffected,
-- archived items (BR-14), idempotency, roles (spec 4: Admin, Cashier, Chef).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(20);

select tests.create_staff('ia.admin', 'admin') as admin \gset
select tests.create_staff('ia.cashier', 'cashier') as cashier \gset
select tests.create_staff('ia.waiter', 'waiter') as waiter \gset
select tests.create_staff('ia.chef', 'chef') as chef \gset
select tests.create_staff('ia.rider', 'rider') as rider \gset
select tests.create_staff('ia.former', 'chef') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(951) as t1 \gset
select tests.create_item('IA Biryani', 70000) as biryani \gset
select tests.create_item('IA Archived', 70000) as archived \gset
update public.menu_items set is_active = false where id = :'archived';

create function tests.avail(p_item uuid, p_available boolean, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.set_item_availability(%L, %L, %L) $f$, p_request, p_item, p_available)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 2))) $$,
  :'t1', :'biryani')) ->> 'order_id' as o1 \gset

-- ===== Sold Out =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'chef', tests.avail(:'biryani', false, :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'is_available', 'false', 'the chef marks the item Sold Out');
select is((select is_available from public.menu_items where id = :'biryani'), false, 'the menu row is Sold Out');
select is(
  tests.outcome_as(:'cashier', format(
    $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$, :'biryani')),
  'ITEM_UNAVAILABLE', 'a Sold Out item cannot be ordered (BR-13)'
);
select is(
  tests.outcome_as(:'waiter', format(
    $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$, :'o1', :'biryani')),
  'ITEM_UNAVAILABLE', 'nor added to an open order'
);
select results_eq(
  format($$ select name_snapshot, quantity::int, is_cancelled from public.order_items where order_id = %L $$, :'o1'),
  $$ values ('IA Biryani'::text, 2, false) $$,
  'the existing order keeps its line (BR-13)'
);
select is((select status::text from public.orders where id = :'o1'), 'accepted', 'and its status');

-- Idempotency (BR-15)
select tests.call_as(:'chef', tests.avail(:'biryani', false, :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a double tap is a replay');
select is(tests.outcome_as(:'chef', tests.avail(:'biryani', true, :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with the opposite value is a conflict');

-- Back in stock
select tests.call_as(:'cashier', tests.avail(:'biryani', true)) as r2 \gset
select is(:'r2'::jsonb ->> 'is_available', 'true', 'the cashier marks it available again');
select is(
  tests.outcome_as(:'cashier', format(
    $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$, :'biryani')),
  'ok', 'and it can be ordered again'
);
select is(tests.call_as(:'cashier', tests.avail(:'biryani', true)) ->> 'is_available', 'true',
  'setting the current value again is harmless');

-- ===== Rules =====
select is(tests.outcome_as(:'chef', tests.avail(:'archived', true)), 'ITEM_NOT_FOUND', 'an archived item cannot be toggled (BR-14)');
select is(tests.outcome_as(:'chef', tests.avail(gen_random_uuid(), false)), 'ITEM_NOT_FOUND', 'an unknown item');
select is(tests.outcome_as(:'chef', tests.avail(:'biryani', null)), 'AVAILABILITY_REQUIRED', 'a value is required');

-- ===== Roles =====
select is(tests.outcome_as(:'admin', tests.avail(:'biryani', false)), 'ok', 'admin may');
select is(tests.outcome_as(:'cashier', tests.avail(:'biryani', false)), 'ok', 'cashier may');
select is(tests.outcome_as(:'waiter', tests.avail(:'biryani', false)), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'rider', tests.avail(:'biryani', false)), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.avail(:'biryani', false)), 'NOT_AUTHORIZED', 'deactivated chef may not');
select is(tests.outcome_as(null, tests.avail(:'biryani', false)), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

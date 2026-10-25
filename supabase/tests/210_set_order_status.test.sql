-- set_order_status (S1): the allowed and forbidden transitions of spec 6.4, Served and the
-- handover with BR-12, cancellation rules, idempotency, and the spec 4 roles.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(65);

select tests.create_staff('os.admin', 'admin') as admin \gset
select tests.create_staff('os.cashier', 'cashier') as cashier \gset
select tests.create_staff('os.waiter', 'waiter') as waiter \gset
select tests.create_staff('os.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('os.chef', 'chef') as chef \gset
select tests.create_staff('os.rider', 'rider') as rider \gset
select tests.create_staff('os.former', 'cashier') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_item('OS Tikka', 60000) as tikka \gset

-- An order (by the waiter for Dine-In, by the cashier for Take Away) brought into a status
-- directly, as the owner. Each Dine-In order gets its own table.
create sequence tests.os_table start 900;
create function tests.order_in(p_type public.order_type, p_status public.order_status, p_paid boolean default false)
returns uuid
language plpgsql
as $$
declare
  v_order uuid;
  v_batch public.batch_status := case p_status
    when 'accepted' then 'sent' when 'pending' then 'sent' when 'preparing' then 'preparing'
    when 'ready' then 'ready' when 'cancelled' then 'cancelled' else 'served' end;
begin
  if p_type = 'dine_in' then
    v_order := tests.call_as(
      (select id from public.profiles where username = 'os.waiter'),
      format($f$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $f$,
             tests.create_table(nextval('tests.os_table')::int),
             (select id from public.menu_items where name = 'OS Tikka'))) ->> 'order_id';
  else
    v_order := tests.call_as(
      (select id from public.profiles where username = 'os.cashier'),
      format($f$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $f$,
             (select id from public.menu_items where name = 'OS Tikka'))) ->> 'order_id';
  end if;
  update public.order_batches set status = v_batch where order_id = v_order;
  update public.orders
     set status = p_status,
         payment_status = case when p_paid or p_status = 'completed' then 'paid' else 'unpaid' end::public.payment_status,
         cancel_reason = case when p_status = 'cancelled' then 'fixture' end,
         cancelled_at = case when p_status = 'cancelled' then now() end
   where id = v_order;
  return v_order;
end;
$$;

create function tests.set_status(p_order uuid, p_status text, p_reason text default null, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.set_order_status(%L, %L, %L, %L) $f$, p_request, p_order, p_status, p_reason)
$$;

-- ===== Spec 6.4 transition matrix (as Cashier, who may set every P1 status) =====
select is(tests.outcome_as(:'cashier', tests.set_status(tests.order_in(m.type, m.from_status, m.paid), m.to_status, 'Test reason')),
          m.expected, format('%s %s%s -> %s: %s', m.type, m.from_status, case when m.paid then ' (paid)' else '' end, m.to_status, m.expected))
  from (values
    ('dine_in'::public.order_type, 'accepted'::public.order_status, false, 'served', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'accepted', false, 'completed', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'accepted', false, 'cancelled', 'ok'),
    ('dine_in', 'preparing', false, 'served', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'preparing', false, 'completed', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'preparing', false, 'cancelled', 'ok'),
    ('dine_in', 'ready', false, 'served', 'ok'),
    ('dine_in', 'ready', false, 'completed', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'ready', false, 'cancelled', 'ORDER_CANNOT_BE_CANCELLED'),
    ('dine_in', 'served', false, 'served', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('dine_in', 'served', false, 'completed', 'ORDER_NOT_PAID'),
    ('dine_in', 'served', true, 'completed', 'ok'),
    ('dine_in', 'served', false, 'cancelled', 'ORDER_CANNOT_BE_CANCELLED'),
    ('dine_in', 'completed', true, 'cancelled', 'ORDER_CLOSED'),
    ('dine_in', 'cancelled', false, 'served', 'ORDER_CLOSED'),
    ('take_away', 'pending', false, 'cancelled', 'ok'),
    ('take_away', 'accepted', false, 'completed', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('take_away', 'accepted', true, 'cancelled', 'ORDER_ALREADY_PAID'),
    ('take_away', 'ready', false, 'served', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('take_away', 'ready', false, 'completed', 'ORDER_NOT_PAID'),
    ('take_away', 'ready', true, 'completed', 'ok'),
    ('take_away', 'ready', false, 'cancelled', 'ORDER_CANNOT_BE_CANCELLED'),
    ('take_away', 'accepted', false, 'accepted', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('take_away', 'accepted', false, 'pending', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('take_away', 'accepted', false, 'preparing', 'KITCHEN_STATUS_USE_BATCHES'),
    ('take_away', 'preparing', false, 'ready', 'KITCHEN_STATUS_USE_BATCHES'),
    ('take_away', 'ready', false, 'out_for_delivery', 'STATUS_TRANSITION_NOT_ALLOWED'),
    ('take_away', 'ready', false, 'delivered', 'STATUS_TRANSITION_NOT_ALLOWED')
  ) as m(type, from_status, paid, to_status, expected);

-- ===== Served by the waiter =====
select tests.order_in('dine_in', 'ready') as o1 \gset
select gen_random_uuid() as req1 \gset
select tests.call_as(:'waiter', tests.set_status(:'o1', 'served', null, :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'status', 'served', 'the waiter marks the order Served');
select is((select string_agg(distinct status::text, ',') from public.order_batches where order_id = :'o1'), 'served',
  'every Ready batch becomes Served');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.order_status_history
            where order_id = %L order by id desc limit 1 $$, :'o1'),
  format($$ values ('ready'::text, 'served'::text, %L::uuid) $$, :'waiter'),
  'the history records the waiter'
);
select is((select t.status::text from public.restaurant_tables t join public.orders o on o.table_id = t.id where o.id = :'o1'),
  'occupied', 'an unpaid Served order keeps its table Occupied (BR-12)');
select tests.call_as(:'waiter', tests.set_status(:'o1', 'served', null, :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a double tap on Served is a replay (BR-15)');
select is(tests.outcome_as(:'waiter', tests.set_status(:'o1', 'cancelled', 'x', :'req1')), 'NOT_AUTHORIZED',
  'the role check comes before the replay');
select is(tests.outcome_as(:'cashier', tests.set_status(:'o1', 'completed', null, :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id for another status is a conflict');

-- Paid before Served: serving completes the order and frees the table (BR-12, G9).
select tests.order_in('dine_in', 'ready', true) as o2 \gset
select tests.call_as(:'waiter', tests.set_status(:'o2', 'served')) as r2 \gset
select is(:'r2'::jsonb ->> 'status', 'completed', 'a paid order is Completed when it is Served (BR-12)');
select is((select t.status::text from public.restaurant_tables t join public.orders o on o.table_id = t.id where o.id = :'o2'),
  'available', 'and its table becomes Available');
select results_eq(
  format($$ select to_status::text from public.order_status_history where order_id = %L and changed_by = %L and from_status <> 'accepted' order by id $$,
         :'o2', :'waiter'),
  $$ values ('served'::text), ('completed') $$,
  'the history records Served then Completed'
);

-- Take Away handover after payment.
select tests.order_in('take_away', 'ready', true) as o3 \gset
select tests.call_as(:'cashier', tests.set_status(:'o3', 'completed')) as r3 \gset
select is(:'r3'::jsonb ->> 'status', 'completed', 'the cashier completes a paid Take Away order at handover');
select ok((select completed_at is not null from public.orders where id = :'o3'), 'completed_at is set');

-- ===== Cancelled =====
select tests.order_in('dine_in', 'preparing') as o4 \gset
select tests.call_as(:'cashier', tests.set_status(:'o4', 'cancelled', '  Customer left  ')) as r4 \gset
select is(:'r4'::jsonb ->> 'status', 'cancelled', 'the cashier cancels a Preparing order');
select results_eq(
  format($$ select cancel_reason, cancelled_by from public.orders where id = %L $$, :'o4'),
  format($$ values ('Customer left'::text, %L::uuid) $$, :'cashier'),
  'the reason (trimmed) and who cancelled are stored'
);
select is((select count(*)::int from public.order_batches where order_id = :'o4' and status <> 'cancelled'), 0,
  'its batches are cancelled, so the kitchen drops them');
select is((select t.status::text from public.restaurant_tables t join public.orders o on o.table_id = t.id where o.id = :'o4'),
  'available', 'the table becomes Available');
select is((select reason from public.order_status_history where order_id = :'o4' and to_status = 'cancelled'),
  'Customer left', 'the history records the reason');
select tests.order_in('dine_in', 'accepted') as o5 \gset
select is(tests.outcome_as(:'cashier', tests.set_status(:'o5', 'cancelled')), 'REASON_REQUIRED', 'a cancellation needs a reason');
select is(tests.outcome_as(:'cashier', tests.set_status(:'o5', 'cancelled', '   ')), 'REASON_REQUIRED', 'a blank reason is not a reason');
select is(tests.outcome_as(:'cashier', tests.set_status(:'o5', null)), 'STATUS_REQUIRED', 'a status is required');
select is(tests.outcome_as(:'cashier', tests.set_status(gen_random_uuid(), 'cancelled', 'x')), 'ORDER_NOT_FOUND', 'an unknown order');
select is(tests.outcome_as(:'cashier', format($$ select public.set_order_status(null, %L, 'cancelled', 'x') $$, :'o5')),
  'REQUEST_ID_REQUIRED', 'a request id is required');

-- ===== Roles (spec 4) =====
select tests.order_in('dine_in', 'ready') as o6 \gset
select is(tests.outcome_as(:'admin', tests.set_status(:'o6', 'served')), 'ok', 'Served: admin may');
select is(tests.outcome_as(:'cashier', tests.set_status(:'o6', 'served')), 'ok', 'Served: cashier may');
select is(tests.outcome_as(:'waiter', tests.set_status(:'o6', 'served')), 'ok', 'Served: the owning waiter may');
select is(tests.outcome_as(:'waiter2', tests.set_status(:'o6', 'served')), 'NOT_AUTHORIZED', 'Served: another waiter may not');
select is(tests.outcome_as(:'chef', tests.set_status(:'o6', 'served')), 'NOT_AUTHORIZED', 'Served: chef may not');
select is(tests.outcome_as(:'rider', tests.set_status(:'o6', 'served')), 'NOT_AUTHORIZED', 'Served: rider may not');
select is(tests.outcome_as(:'former', tests.set_status(:'o6', 'served')), 'NOT_AUTHORIZED', 'Served: deactivated staff may not');
select is(tests.outcome_as(null, tests.set_status(:'o6', 'served')), 'PERMISSION_DENIED', 'Served: anon may not');

select tests.order_in('dine_in', 'accepted') as o7 \gset
select is(tests.outcome_as(:'admin', tests.set_status(:'o7', 'cancelled', 'x')), 'ok', 'Cancel: admin may');
select is(tests.outcome_as(:'waiter', tests.set_status(:'o7', 'cancelled', 'x')), 'NOT_AUTHORIZED', 'Cancel: the owning waiter may not (BR-09)');
select is(tests.outcome_as(:'chef', tests.set_status(:'o7', 'cancelled', 'x')), 'NOT_AUTHORIZED', 'Cancel: chef may not');
select is(tests.outcome_as(:'chef', tests.set_status(:'o7', 'preparing')), 'KITCHEN_STATUS_USE_BATCHES', 'chef: kitchen states go through set_batch_status');
select is(tests.outcome_as(:'waiter', tests.set_status(:'o7', 'preparing')), 'NOT_AUTHORIZED', 'waiter may not set kitchen states');

select tests.order_in('take_away', 'ready', true) as o8 \gset
select is(tests.outcome_as(:'admin', tests.set_status(:'o8', 'completed')), 'ok', 'Handover: admin may');
select is(tests.outcome_as(:'waiter', tests.set_status(:'o8', 'completed')), 'NOT_AUTHORIZED', 'Handover: waiter may not');

select * from finish();
rollback;

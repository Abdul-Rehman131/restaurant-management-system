-- Order helpers (S1): idempotent replay, lock_open_order, and the order status derived from
-- its batches (BR-08, G2, G3).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(25);

select tests.create_staff('oh.waiter', 'waiter') as waiter \gset
select tests.create_staff('oh.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('oh.cashier', 'cashier') as cashier \gset
select tests.create_table(601) as t1 \gset
select tests.create_order('dine_in', :'t1', 601) as o1 \gset
update public.orders set waiter_id = :'waiter' where id = :'o1';
select gen_random_uuid() as req \gset
select gen_random_uuid() as target \gset

-- ===== replay / remember (BR-15) =====
select tests.claims_as(:'waiter');
select is(private.replay('f', :'req', :'target'), null, 'replay: a new request id gives NULL');
select is(
  private.remember('f', :'req', :'target', '{"x": 1}')::text, '{"x": 1, "replayed": false}',
  'remember: returns the result with replayed = false'
);
select is(
  private.replay('f', :'req', :'target')::text, '{"x": 1, "replayed": true}',
  'replay: the same request returns the stored result with replayed = true'
);
select throws_ok(
  format($$ select private.replay('g', %L, %L) $$, :'req', :'target'),
  'P0001', 'REQUEST_ID_CONFLICT', 'replay: the id used by another function is a conflict'
);
select throws_ok(
  format($$ select private.replay('f', %L, gen_random_uuid()) $$, :'req'),
  'P0001', 'REQUEST_ID_CONFLICT', 'replay: the id used for another target is a conflict'
);
select throws_ok(
  format($$ select private.replay('f', %L, %L, '{"status": "ready"}') $$, :'req', :'target'),
  'P0001', 'REQUEST_ID_CONFLICT', 'replay: the id used with other arguments is a conflict'
);
select throws_ok($$ select private.replay('f', null, null) $$, 'P0001', 'REQUEST_ID_REQUIRED', 'replay: NULL id');
select throws_ok(
  format($$ select private.replay('f', %L, null) $$, (select request_id from public.orders where id = :'o1')),
  'P0001', 'REQUEST_ID_CONFLICT', 'replay: an id already used by create_order is a conflict'
);
select tests.logout();
select tests.claims_as(:'waiter2');
select throws_ok(
  format($$ select private.replay('f', %L, %L) $$, :'req', :'target'),
  'P0001', 'REQUEST_ID_CONFLICT', 'replay: another user cannot reuse the id'
);
select tests.logout();

-- ===== lock_open_order =====
select tests.claims_as(:'waiter');
select is((private.lock_open_order(:'o1', 'waiter')).id, :'o1'::uuid, 'lock_open_order: the owning waiter gets the order');
select throws_ok(
  $$ select private.lock_open_order(gen_random_uuid(), 'waiter') $$,
  'P0001', 'ORDER_NOT_FOUND', 'lock_open_order: unknown order'
);
select tests.logout();
select tests.claims_as(:'waiter2');
select throws_ok(
  format($$ select private.lock_open_order(%L, 'waiter') $$, :'o1'),
  '42501', 'NOT_AUTHORIZED', 'lock_open_order: another waiter is refused (own orders only)'
);
select tests.logout();
select tests.claims_as(:'cashier');
select is((private.lock_open_order(:'o1', 'cashier')).id, :'o1'::uuid, 'lock_open_order: a cashier gets any order');
select tests.logout();

-- ===== sync_order_status =====
-- Batch 1 is Sent: Accepted stays Accepted (no history row).
select is(private.sync_order_status(:'o1', null, null)::text, 'accepted', 'sync: a Sent batch keeps the order Accepted');
select is((select count(*)::int from public.order_status_history where order_id = :'o1'), 0, 'sync: no change, no history');

update public.order_batches set status = 'preparing' where order_id = :'o1' and batch_no = 1;
select is(private.sync_order_status(:'o1', :'cashier', null)::text, 'preparing', 'sync: a Preparing batch makes the order Preparing');
select ok((select preparing_at is not null from public.orders where id = :'o1'), 'sync: preparing_at is set');

update public.order_batches set status = 'ready' where order_id = :'o1' and batch_no = 1;
select is(private.sync_order_status(:'o1', :'cashier', null)::text, 'ready', 'sync: all batches Ready makes the order Ready (BR-08)');

-- G2: an add-on batch on a Ready order moves it back to Accepted.
insert into public.order_batches (order_id, batch_no) values (:'o1', 2);
select is(private.sync_order_status(:'o1', null, 'Add-on batch 2')::text, 'accepted', 'sync: a new kitchen batch moves a Ready order back to Accepted (G2)');

update public.order_batches set status = 'preparing' where order_id = :'o1' and batch_no = 2;
select is(private.sync_order_status(:'o1', null, null)::text, 'preparing', 'sync: Ready + Preparing batches make the order Preparing');

update public.order_batches set status = 'served' where order_id = :'o1' and batch_no = 1;
update public.order_batches set status = 'cancelled' where order_id = :'o1' and batch_no = 2;
select is(private.sync_order_status(:'o1', null, null)::text, 'served', 'sync: cancelled batches are ignored; all others Served makes it Served');

select results_eq(
  format($$ select from_status::text, to_status::text, changed_by, reason
            from public.order_status_history where order_id = %L order by id $$, :'o1'),
  format($$ values ('accepted', 'preparing', %L::uuid, null::text), ('preparing', 'ready', %L::uuid, null),
                   ('ready', 'accepted', null, 'Add-on batch 2'), ('accepted', 'preparing', null, null),
                   ('preparing', 'served', null, null) $$, :'cashier', :'cashier'),
  'sync: every change is written to the history, with who and why'
);

-- Final statuses are never changed.
update public.orders set status = 'cancelled', cancel_reason = 'test', cancelled_at = now() where id = :'o1';
update public.order_batches set status = 'sent' where order_id = :'o1' and batch_no = 2;
select is(private.sync_order_status(:'o1', null, null)::text, 'cancelled', 'sync: a cancelled order is never changed');
select tests.claims_as(:'cashier');
select throws_ok(
  format($$ select private.lock_open_order(%L, 'cashier') $$, :'o1'),
  'P0001', 'ORDER_CLOSED', 'lock_open_order: a cancelled order is closed'
);
select tests.logout();

-- ===== request_log is private =====
select ok(
  not has_table_privilege('authenticated', 'private.request_log', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'private.request_log', 'SELECT,INSERT,UPDATE,DELETE'),
  'the API roles have no access to private.request_log'
);

select * from finish();
rollback;

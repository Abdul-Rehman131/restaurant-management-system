-- Concurrency (T6): two real database sessions creating an order for the same table at the
-- same moment. pgTAP runs inside one transaction, so the two "staff devices" are separate
-- connections opened with dblink. They only see COMMITTED data, so they use the local seed
-- rows (waiter1, waiter2, tables 9-12, a seed menu item).
--
-- Part 1 never commits. Part 2 must commit to show the real outcome, so it tags its orders
-- (customer_name = 'CONCURRENCY-TEST') and removes them, before and after, in a cleanup
-- session, then re-syncs the order counters, so other tests and later runs are unaffected.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
\ir helpers.psql

select plan(9);

select id as waiter1 from public.profiles where username = 'waiter1' \gset
select id as waiter2 from public.profiles where username = 'waiter2' \gset
select id as table9 from public.restaurant_tables where number = 9 and is_active \gset
select id as table10 from public.restaurant_tables where number = 10 and is_active \gset
select id as table11 from public.restaurant_tables where number = 11 and is_active \gset
select id as table12 from public.restaurant_tables where number = 12 and is_active \gset
select id as item from public.menu_items where name = 'Chicken Tikka (Leg)' and is_active \gset

-- Local stack only (well-known local password). dblink requires the server to really check a
-- password, and 127.0.0.1 is trusted without one, so connect to the address this test session
-- itself came in on (the Docker network, which requires a password). Works in CI as well.
select format('dbname=postgres user=postgres password=postgres host=%s port=%s',
              host(inet_server_addr()), inet_server_port()) as conn \gset

create function tests.remote_begin(p_conn text, p_user uuid, p_lock_timeout text default '0')
returns void
language plpgsql
as $$
begin
  perform dblink_exec(p_conn, 'begin');
  perform * from dblink(p_conn, format('select set_config(%L, %L, true)', 'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text)) as t(x text);
  perform dblink_exec(p_conn, 'set local role authenticated');
  perform dblink_exec(p_conn, format('set local lock_timeout = %L', p_lock_timeout));
end;
$$;

-- Calls create_order in the remote session. Returns the result, or 'ERROR: <message>'.
create function tests.remote_create_order(p_conn text, p_request uuid, p_table uuid, p_item uuid)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  select r into v_result
    from dblink(p_conn, format(
      'select public.create_order(%L, %L, %L, %L, null, %L)::text',
      p_request, 'dine_in', p_table, 'CONCURRENCY-TEST',
      jsonb_build_array(jsonb_build_object('menu_item_id', p_item, 'quantity', 1))), false) as t(r text);
  return coalesce(v_result, 'ERROR: ' || dblink_error_message(p_conn));
end;
$$;

create function tests.cleanup_concurrency(p_conn text)
returns void
language plpgsql
as $$
begin
  perform dblink_exec(p_conn, $sql$
    begin;
    alter table public.order_status_history disable trigger order_status_history_append_only;
    delete from public.order_status_history
     where order_id in (select id from public.orders where customer_name = 'CONCURRENCY-TEST');
    delete from public.order_items
     where order_id in (select id from public.orders where customer_name = 'CONCURRENCY-TEST');
    delete from public.order_batches
     where order_id in (select id from public.orders where customer_name = 'CONCURRENCY-TEST');
    update public.restaurant_tables set status = 'available'
     where id in (select table_id from public.orders where customer_name = 'CONCURRENCY-TEST');
    delete from public.orders where customer_name = 'CONCURRENCY-TEST';
    alter table public.order_status_history enable trigger order_status_history_append_only;
    update public.order_counters c
       set last_number = coalesce((select max(split_part(o.order_number, '-', 3)::int)
                                     from public.orders o
                                    where o.business_date = c.business_date
                                      and o.branch_id = c.branch_id), 0);
    commit;
  $sql$);
end;
$$;

select dblink_connect('a', :'conn');
select dblink_connect('b', :'conn');
select dblink_connect('cleanup', :'conn');
select tests.cleanup_concurrency('cleanup');

-- ===== Part 1: while A holds a table, B cannot create an order for it (nothing committed) =====
select tests.remote_begin('a', :'waiter1');
select ok(
  tests.remote_create_order('a', gen_random_uuid(), :'table11', :'item') like '{%"status": "accepted"%',
  'session A creates an order for table 11 (not yet committed)'
);
select tests.remote_begin('b', :'waiter2', '1s');
select alike(
  tests.remote_create_order('b', gen_random_uuid(), :'table11', :'item'),
  '%lock timeout%',
  'session B must wait for A''s lock on table 11: it cannot open a second order meanwhile'
);
select dblink_exec('b', 'rollback');
select dblink_exec('a', 'rollback');

select tests.remote_begin('b', :'waiter2', '1s');
select ok(
  tests.remote_create_order('b', gen_random_uuid(), :'table11', :'item') like '{%"status": "accepted"%',
  'once A gave up (rolled back), B can create the order for table 11'
);
select dblink_exec('b', 'rollback');

-- Same request id from two sessions (a double tap on two connections) is serialised too.
select gen_random_uuid() as same_request \gset
select tests.remote_begin('a', :'waiter1');
select ok(
  tests.remote_create_order('a', :'same_request', :'table10', :'item') like '{%"replayed": false%',
  'session A starts a request'
);
select tests.remote_begin('b', :'waiter1', '1s');
select alike(
  tests.remote_create_order('b', :'same_request', :'table9', :'item'),
  '%lock timeout%',
  'the same request id in session B waits for A instead of creating a second order (BR-15)'
);
select dblink_exec('b', 'rollback');
select dblink_exec('a', 'rollback');

-- ===== Part 2: the real race. Both tap Send for table 12 at the same moment =====
select tests.remote_begin('a', :'waiter1');
select ok(
  tests.remote_create_order('a', gen_random_uuid(), :'table12', :'item') like '{%"status": "accepted"%',
  'waiter 1 (session A) creates the order for table 12'
);
-- Waiter 2 sends at the same time: the call blocks on table 12's row lock.
select tests.remote_begin('b', :'waiter2');
select dblink_send_query('b', format(
  'select public.create_order(%L, %L, %L, %L, null, %L)::text',
  gen_random_uuid(), 'dine_in', :'table12', 'CONCURRENCY-TEST',
  jsonb_build_array(jsonb_build_object('menu_item_id', :'item', 'quantity', 1))));
select pg_sleep(0.5);
select is(dblink_is_busy('b'), 1, 'waiter 2 (session B) is waiting while waiter 1''s order is in progress');

select dblink_exec('a', 'commit');
-- B now gets the lock, re-checks, and sees the committed open order.
create temp table b_result as select * from dblink_get_result('b', false) as t(r text);
select alike(
  coalesce((select r from b_result), 'ERROR: ' || dblink_error_message('b')),
  '%TABLE_HAS_OPEN_ORDER%',
  'after waiter 1 commits, waiter 2 gets TABLE_HAS_OPEN_ORDER: exactly one order for the table (BR-05)'
);
select * from dblink_get_result('b', false) as t(r text);
select dblink_exec('b', 'rollback');

select is(
  (select count(*)::int from public.orders
    where table_id = :'table12' and status not in ('completed', 'cancelled')),
  1,
  'table 12 has exactly one open order'
);

select tests.cleanup_concurrency('cleanup');
select dblink_disconnect('a');
select dblink_disconnect('b');
select dblink_disconnect('cleanup');

select * from finish();
rollback;

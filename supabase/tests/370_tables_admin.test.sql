-- Restaurant tables for the Admin (S5, M3): create, edit, unique numbers, archive refused
-- while an order is open (BR-05), restore, audit (BR-24), idempotency (BR-15), roles.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(28);

select tests.create_staff('tb.admin', 'admin') as admin \gset
select tests.create_staff('tb.cashier', 'cashier') as cashier \gset
select tests.create_staff('tb.waiter', 'waiter') as waiter \gset
select tests.create_staff('tb.chef', 'chef') as chef \gset
select tests.create_staff('tb.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_item('TB Tea', 20000, false) as tea \gset

create function tests.save(p_id uuid, p_number integer, p_capacity integer, p_section text,
                           p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.save_table(%L, %L, %L, %L, %L) $f$, p_request, p_id, p_number, p_capacity, p_section)
$$;
create function tests.active(p_id uuid, p_active boolean, p_reason text) returns text language sql as $$
  select format($f$ select public.set_table_active(gen_random_uuid(), %L, %L, %L) $f$, p_id, p_active, p_reason)
$$;

-- ===== Create and edit =====
select gen_random_uuid() as req \gset
select tests.call_as(:'admin', tests.save(null, 971, 6, '  Terrace ', :'req')) as r1 \gset
select :'r1'::jsonb -> 'table' ->> 'id' as t1 \gset
select is(:'r1'::jsonb -> 'table' ->> 'section', 'Terrace', 'a table is created, the section trimmed');
select is(:'r1'::jsonb -> 'table' ->> 'status', 'available', 'it starts Available');
select is(tests.call_as(:'admin', tests.save(null, 971, 6, '  Terrace ', :'req')) ->> 'replayed', 'true', 'a double tap is a replay');
select is((select count(*)::int from public.restaurant_tables where number = 971), 1, 'and creates one table');
select is(tests.outcome_as(:'admin', tests.save(null, 971, 2, 'Hall')), 'TABLE_NUMBER_TAKEN', 'active numbers are unique');
select is(tests.outcome_as(:'admin', tests.save(null, 0, 2, 'Hall')), 'TABLE_NUMBER_INVALID', 'number 1 to 999');
select is(tests.outcome_as(:'admin', tests.save(null, 1000, 2, 'Hall')), 'TABLE_NUMBER_INVALID', 'not 1000');
select is(tests.outcome_as(:'admin', tests.save(null, 972, 0, 'Hall')), 'CAPACITY_INVALID', 'capacity 1 to 50');
select is(tests.outcome_as(:'admin', tests.save(null, 972, 51, 'Hall')), 'CAPACITY_INVALID', 'not 51');
select is(tests.outcome_as(:'admin', tests.save(null, 972, 2, ' ')), 'SECTION_INVALID', 'a section is required');
select is(tests.outcome_as(:'admin', tests.save(null, 972, 2, repeat('x', 41))), 'SECTION_INVALID', 'at most 40 characters');
select tests.call_as(:'admin', tests.save(:'t1', 973, 8, 'Roof')) as r2 \gset
select is(:'r2'::jsonb -> 'table' ->> 'number', '973', 'a table is renumbered');
select is((:'r2'::jsonb -> 'table' ->> 'capacity')::int, 8, 'and its capacity changed');
select is(tests.outcome_as(:'admin', tests.save(gen_random_uuid(), 974, 2, 'Hall')), 'TABLE_NOT_FOUND', 'an unknown table');

-- ===== Archive: refused while an order is open =====
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tea')) ->> 'order_id' as o1 \gset
select is(tests.outcome_as(:'admin', tests.active(:'t1', false, 'Broken')), 'TABLE_HAS_OPEN_ORDER',
  'a table with an open order cannot be archived');
select is(tests.outcome_as(:'admin', tests.active(:'t1', false, null)), 'REASON_REQUIRED', 'archiving needs a reason');
update public.orders set status = 'completed', payment_status = 'paid' where id = :'o1';
update public.restaurant_tables set status = 'available' where id = :'t1';
select tests.call_as(:'admin', tests.active(:'t1', false, 'Broken leg')) as arch \gset
select is(:'arch'::jsonb -> 'table' ->> 'is_active', 'false', 'after the order closes, the table is archived');
select is((select reason from public.audit_log where action = 'restaurant_table.archived' and target_id = :'t1'),
  'Broken leg', 'with the reason in the audit log');
select tests.login_as(:'waiter');
select is((select count(*)::int from public.restaurant_tables where id = :'t1'), 0, 'waiters no longer see it');
select tests.logout();
select is(tests.outcome_as(:'admin', tests.save(:'t1', 973, 8, 'Roof')), 'TABLE_NOT_FOUND', 'an archived table cannot be edited');

-- Restore: the number must be free.
select tests.call_as(:'admin', tests.save(null, 973, 2, 'Hall')) -> 'table' ->> 'id' as t2 \gset
select is(tests.outcome_as(:'admin', tests.active(:'t1', true, null)), 'TABLE_NUMBER_TAKEN',
  'a table cannot be restored while its number is in use');
select tests.call_as(:'admin', tests.active(:'t2', false, 'Merged')) as a2 \gset
select is(tests.call_as(:'admin', tests.active(:'t1', true, null)) -> 'table' ->> 'is_active', 'true', 'then it is restored');
select is((select count(*)::int from public.audit_log where action = 'restaurant_table.restored' and target_id = :'t1'),
  1, 'the restore is in the audit log');

-- ===== Roles =====
select is(tests.outcome_as(:'cashier', tests.save(null, 975, 2, 'Hall')), 'NOT_AUTHORIZED', 'cashier may not');
select is(tests.outcome_as(:'waiter', tests.active(:'t1', false, 'x')), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'chef', tests.save(null, 975, 2, 'Hall')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'former', tests.save(null, 975, 2, 'Hall')), 'NOT_AUTHORIZED', 'a deactivated admin may not');
select is(tests.outcome_as(null, tests.save(null, 975, 2, 'Hall')), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;

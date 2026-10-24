-- Order status history: append-only, real changes only.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(5);

select tests.create_order('take_away', null, 1) as o1 \gset

select lives_ok(
  format($$ insert into public.order_status_history (order_id, from_status, to_status)
            values (%L, null, 'accepted') $$, :'o1'),
  'a status change is recorded'
);
select throws_ok(
  format($$ insert into public.order_status_history (order_id, from_status, to_status)
            values (%L, 'accepted', 'accepted') $$, :'o1'),
  '23514', null, 'a non-change (same from and to) is rejected'
);
select throws_ok(
  $$ update public.order_status_history set to_status = 'cancelled' $$,
  'P0001', null, 'history rows cannot be updated'
);
select throws_ok(
  $$ delete from public.order_status_history $$,
  'P0001', null, 'history rows cannot be deleted'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_status_history'::regclass),
  'RLS is enabled on order_status_history'
);

select * from finish();
rollback;

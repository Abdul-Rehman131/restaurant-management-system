-- Audit log: append-only and well-formed actions.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select lives_ok(
  $$ insert into public.audit_log (action, target_table, target_id, reason, old_value, new_value)
     values ('menu_item.price_change', 'menu_items', gen_random_uuid()::text, null,
             '{"price": 60000}', '{"price": 65000}') $$,
  'an audit entry is recorded'
);
select throws_ok(
  $$ insert into public.audit_log (action, target_table, target_id) values ('Bad Action!', 'orders', 'x') $$,
  '23514', null, 'actions use a lower-case dotted code'
);
select throws_ok($$ update public.audit_log set reason = 'edited' $$, 'P0001', null, 'audit entries cannot be updated');
select throws_ok($$ delete from public.audit_log $$, 'P0001', null, 'audit entries cannot be deleted');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
  'RLS is enabled on audit_log'
);

select * from finish();
rollback;

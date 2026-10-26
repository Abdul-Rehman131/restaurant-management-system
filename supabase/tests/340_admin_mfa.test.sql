-- MFA enforcement (S5, M1): an Admin session at aal1 (password only) is refused by every Admin
-- RPC, reads and writes, with MFA_REQUIRED; at aal2 it works. Other roles have no second
-- factor in P1 and are not affected. my_role() and RLS reads keep working at aal1, so the
-- MFA screen and the account-status check still run.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(12);

select tests.create_staff('mf.admin', 'admin') as admin \gset
select tests.create_staff('mf.cashier', 'cashier') as cashier \gset

-- Runs p_sql as p_user at the given aal, always rolled back; returns 'ok' or the error.
create function tests.outcome_aal(p_user uuid, p_aal text, p_sql text)
returns text language plpgsql as $$
declare
  v_outcome text;
begin
  begin
    perform tests.login_as(p_user, p_aal);
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v_outcome := case when sqlstate = 'XTEST' then 'ok' else sqlerrm end;
  end;
  perform tests.logout();
  return v_outcome;
end;
$$;

-- ===== Admin at aal1 =====
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.get_settings()'), 'MFA_REQUIRED',
  'an aal1 Admin cannot read settings');
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.get_sales_summary()'), 'MFA_REQUIRED',
  'nor the report');
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.admin_menu()'), 'MFA_REQUIRED',
  'nor the admin menu (cost prices)');
select is(tests.outcome_aal(:'admin', 'aal1',
  $$ select public.update_settings(gen_random_uuid(), '{"restaurant_name": "X"}') $$), 'MFA_REQUIRED',
  'nor change settings');
select is(tests.outcome_aal(:'admin', 'aal1',
  $$ select public.save_category(gen_random_uuid(), null, 'MF Soups') $$), 'MFA_REQUIRED',
  'nor change the menu');
select is(tests.outcome_aal(:'admin', 'aal1',
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, '[]') $$), 'MFA_REQUIRED',
  'nor take an order');
select is(tests.outcome_aal(:'admin', null, 'select public.get_settings()'), 'MFA_REQUIRED',
  'a session without an aal claim counts as aal1');

-- ===== What still works at aal1 =====
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.my_role()'), 'ok',
  'my_role() works at aal1 (account-status check on the MFA screen)');
select tests.login_as(:'admin', 'aal1');
select is(public.my_role()::text, 'admin', 'and still says admin');
select tests.logout();

-- ===== aal2, and other roles =====
select is(tests.outcome_aal(:'admin', 'aal2', 'select public.get_settings()'), 'ok',
  'an aal2 Admin reads settings');
select is(tests.outcome_aal(:'admin', 'aal2',
  $$ select public.save_category(gen_random_uuid(), null, 'MF Soups') $$), 'ok',
  'and changes the menu');
select is(tests.outcome_aal(:'cashier', 'aal1', 'select public.get_settings()'), 'ok',
  'a cashier at aal1 is not affected (no second factor in P1)');

select * from finish();
rollback;

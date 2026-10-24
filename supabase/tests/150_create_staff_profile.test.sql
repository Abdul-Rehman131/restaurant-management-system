-- create_staff_profile (T10): service_role adds the profile for a login created through the
-- Auth admin API. No staff role and no anonymous caller may run it.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(15);

select tests.create_staff('admin.csp', 'admin') as admin \gset
select tests.create_staff('cashier.csp', 'cashier') as cashier \gset
select tests.create_staff('waiter.csp', 'waiter') as waiter \gset
select tests.create_staff('chef.csp', 'chef') as chef \gset
select tests.create_staff('rider.csp', 'rider') as rider \gset

-- A login without a profile, as the Auth admin API leaves it.
insert into auth.users (id, email, aud, role)
values ('c0000000-0000-0000-0000-000000000001', 'newcook@staff.invalid', 'authenticated', 'authenticated');
insert into auth.users (id, email, aud, role)
values ('c0000000-0000-0000-0000-000000000002', 'other@staff.invalid', 'authenticated', 'authenticated');

-- Grants
select ok(
  has_function_privilege('service_role', 'public.create_staff_profile(uuid, text, text, public.app_role)', 'execute'),
  'service_role can execute create_staff_profile()'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_staff_profile(uuid, text, text, public.app_role)', 'execute'),
  'authenticated cannot execute create_staff_profile()'
);
select ok(
  not has_function_privilege('anon', 'public.create_staff_profile(uuid, text, text, public.app_role)', 'execute'),
  'anon cannot execute create_staff_profile()'
);

-- Every staff role and anon is refused, even an admin.
select tests.login_as(:'admin');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'admin cannot call it from the browser');
select tests.logout();
select tests.login_as(:'cashier');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'cashier cannot call it');
select tests.logout();
select tests.login_as(:'waiter');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'waiter cannot call it');
select tests.logout();
select tests.login_as(:'chef');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'chef cannot call it');
select tests.logout();
select tests.login_as(:'rider');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'rider cannot call it');
select tests.logout();
select tests.login_as_anon();
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef') $$,
  '42501', null, 'anon cannot call it');
select tests.logout();

-- service_role
set local role service_role;
select is(
  public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef'),
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'service_role creates the profile and gets its id back'
);
select is(
  public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'newcook', 'New Cook', 'chef'),
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'calling it again for the same login and username is a no-op'
);
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000001', 'renamed', 'New Cook', 'chef') $$,
  'P0001', 'PROFILE_EXISTS', 'a login that already has a profile cannot get a second username');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000002', 'newcook', 'Other', 'waiter') $$,
  'P0001', 'USERNAME_TAKEN', 'a username already in use is refused');
select throws_ok($$ select public.create_staff_profile('c0000000-0000-0000-0000-000000000002', 'notother', 'Other', 'waiter') $$,
  'P0001', 'PROFILE_EMAIL_MISMATCH', 'the username must match the login email');
reset role;

select results_eq(
  $$ select role::text, is_active from public.profiles where id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('chef', true) $$,
  'exactly one active profile with the requested role was created'
);

select * from finish();
rollback;

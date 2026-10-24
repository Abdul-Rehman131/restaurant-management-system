-- Auth helpers: my_role() from profiles (deactivation is immediate) and the username login
-- mapping.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(14);

select tests.create_staff('waiter.h', 'waiter') as waiter \gset
select tests.create_staff('admin.h', 'admin') as admin \gset

-- staff_login_email (Q3)
select is(public.staff_login_email('waiter1'), 'waiter1@staff.invalid', 'username maps to <username>@staff.invalid');
select is(public.staff_login_email('  Waiter1 '), 'waiter1@staff.invalid', 'the mapping trims and lower-cases');
select throws_ok($$ select public.staff_login_email('no spaces allowed') $$, 'P0001', 'USERNAME_INVALID', 'invalid usernames are rejected');
select throws_ok($$ select public.staff_login_email(null) $$, 'P0001', 'USERNAME_INVALID', 'a NULL username is rejected');

-- Profile and login email can never drift
select throws_ok(
  format($$ update public.profiles set username = 'renamed.h' where id = %L $$, :'waiter'),
  'P0001', 'PROFILE_EMAIL_MISMATCH', 'renaming a profile without changing its login email is rejected'
);
select throws_ok(
  $$ insert into auth.users (id, email, aud, role)
       values ('b0000000-0000-0000-0000-0000000000aa', 'someone@example.com', 'authenticated', 'authenticated');
     insert into public.profiles (id, username, full_name, role)
       values ('b0000000-0000-0000-0000-0000000000aa', 'someone', 'Someone', 'waiter') $$,
  'P0001', 'PROFILE_EMAIL_MISMATCH', 'a profile whose login is not <username>@staff.invalid is rejected'
);

-- my_role() reads the role from profiles for auth.uid()
select tests.login_as(:'waiter');
select is(public.my_role(), 'waiter'::public.app_role, 'my_role() returns the caller''s role');
select tests.logout();
select tests.login_as(:'admin');
select is(public.my_role(), 'admin'::public.app_role, 'my_role() follows the logged-in user');
select tests.logout();

select tests.login_as('b0000000-0000-0000-0000-0000000000ff');
select is(public.my_role(), null, 'my_role() is NULL for a user without a profile');
select tests.logout();

-- Deactivation takes effect on the very next request (same JWT)
update public.profiles set is_active = false where id = :'waiter';
select tests.login_as(:'waiter');
select is(public.my_role(), null, 'my_role() is NULL as soon as the profile is deactivated');
select tests.logout();
update public.profiles set is_active = true where id = :'waiter';

-- Who may execute the helpers
select ok(has_function_privilege('authenticated', 'public.my_role()', 'execute'), 'authenticated can execute my_role()');
select ok(not has_function_privilege('anon', 'public.my_role()', 'execute'), 'anon cannot execute my_role()');
select ok(
  not has_function_privilege('authenticated', 'public.staff_login_email(text)', 'execute'),
  'authenticated cannot execute staff_login_email() (the browser computes it itself)'
);
select ok(
  has_function_privilege('service_role', 'public.staff_login_email(text)', 'execute'),
  'service_role (Edge Functions) can execute staff_login_email()'
);

select * from finish();
rollback;

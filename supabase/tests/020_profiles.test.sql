-- Profiles: constraints, uniqueness and archive-not-delete.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(7);

select lives_ok($$ select tests.create_staff('waiter.one', 'waiter') $$, 'a valid staff profile is created');

select throws_ok(
  $$ select tests.create_staff('waiter.one', 'cashier') $$,
  '23505', null, 'usernames are unique'
);
select throws_ok(
  $$ select tests.create_staff('Bad Name', 'chef') $$,
  'P0001', 'USERNAME_INVALID', 'usernames must be lower-case without spaces'
);
select throws_ok(
  $$ select tests.create_staff('ab', 'chef') $$,
  'P0001', 'USERNAME_INVALID', 'usernames need at least 3 characters'
);

select is(
  (select is_active from public.profiles where username = 'waiter.one'),
  true,
  'new staff are active by default'
);

select throws_ok(
  $$ delete from auth.users where email = 'waiter.one@staff.invalid' $$,
  '23503', null, 'a login with a profile cannot be deleted (archive with is_active instead)'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);

select * from finish();
rollback;

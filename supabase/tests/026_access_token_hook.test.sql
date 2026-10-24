-- Custom Access Token Hook: app_role claim for active staff, tokens refused for inactive or
-- unknown users, callable only by Supabase Auth.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(8);

select tests.create_staff('cashier.k', 'cashier') as cashier \gset

select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', :'cashier', 'claims', jsonb_build_object('sub', :'cashier', 'role', 'authenticated')
  )) #>> '{claims,app_role}',
  'cashier',
  'the hook adds app_role from profiles'
);
select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', :'cashier', 'claims', jsonb_build_object('sub', :'cashier', 'role', 'authenticated')
  )) #>> '{claims,role}',
  'authenticated',
  'the standard role claim is left unchanged'
);

update public.profiles set is_active = false where id = :'cashier';
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', :'cashier', 'claims', '{}'::jsonb))
    #>> '{error,http_code}',
  '403',
  'no token is issued or refreshed for a deactivated staff member'
);
select ok(
  public.custom_access_token_hook(jsonb_build_object('user_id', :'cashier', 'claims', '{}'::jsonb))
    -> 'claims' is null,
  'the refusal carries no claims'
);
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', gen_random_uuid(), 'claims', '{}'::jsonb))
    #>> '{error,http_code}',
  '403',
  'no token is issued for a login without a staff profile'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'Supabase Auth can execute the hook'
);
select ok(
  not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'authenticated cannot call the hook'
);
select ok(
  not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'anon cannot call the hook'
);

select * from finish();
rollback;

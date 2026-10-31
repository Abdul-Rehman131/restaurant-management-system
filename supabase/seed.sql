-- LOCAL-ONLY DEMO DATA. Runs after the migrations on `pnpm db:reset`, and NEVER on staging or
-- production. Every value here is fake: the demo brand "Ember Kitchen", demo staff logins,
-- placeholder contact details and made-up prices. No real owner or business data.
--
-- Demo logins (local only): username / demo-password-123 (login email <username>@staff.invalid,
-- see public.staff_login_email)
--   admin, cashier, waiter1, waiter2, chef, rider
--   former: a DEACTIVATED waiter, for the "deactivated user is denied" e2e test

-- Demo brand, DEMO rates (16% tax, 5% service), 6 categories, 30 items and 12 tables: the same
-- function `pnpm seed:staging -- --demo-data` runs on staging (migration demo_data), so local
-- and staging demo data never drift apart.
select public.ops_demo_data(false);

-- Staff: auth users (GoTrue needs the token columns as '' rather than NULL), identities and
-- profiles. Fixed ids so tests and docs can refer to them.
with staff (id, username, full_name, role) as (
  values
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'admin',   'Demo Admin',      'admin'::public.app_role),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'cashier', 'Demo Cashier',    'cashier'),
    ('a0000000-0000-0000-0000-000000000003'::uuid, 'waiter1', 'Demo Waiter One', 'waiter'),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'waiter2', 'Demo Waiter Two', 'waiter'),
    ('a0000000-0000-0000-0000-000000000005'::uuid, 'chef',    'Demo Chef',       'chef'),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'rider',   'Demo Rider',      'rider'),
    ('a0000000-0000-0000-0000-000000000007'::uuid, 'former',  'Demo Former Waiter', 'waiter')
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated',
    public.staff_login_email(s.username),
    extensions.crypt('demo-password-123', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', s.full_name),
    now(), now(), '', '', '', ''
  from staff s
  returning id, email
),
new_identities as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from new_users u
  returning user_id
)
insert into public.profiles (id, username, full_name, role)
select s.id, s.username, s.full_name, s.role
from staff s
join new_identities i on i.user_id = s.id;

-- A former staff member: the account exists but is archived (rule 6), so sign-in is refused.
update public.profiles set is_active = false where username = 'former';

-- LOCAL-ONLY DEMO DATA. Runs after the migrations on `pnpm db:reset`, and NEVER on staging or
-- production. Every value here is fake: the demo brand "Ember Kitchen", example.com logins,
-- placeholder contact details and made-up prices. No real owner or business data.
--
-- Demo logins (local only): username@example.com / demo-password-123
--   admin, cashier, waiter1, waiter2, chef, rider

-- Settings: demo brand and DEMO rates only (the real rates are open question Q1/D2).
update public.settings
   set restaurant_name = 'Ember Kitchen (Demo)',
       address = 'Demo address, not a real location',
       phone = '+00 000 000 0000',
       receipt_footer = 'Demo receipt. Not a real business.',
       tax_bps = 1600,
       service_charge_bps = 500
 where branch_id = private.default_branch_id();

-- Staff: auth users (GoTrue needs the token columns as '' rather than NULL), identities and
-- profiles. Fixed ids so tests and docs can refer to them.
with staff (id, username, full_name, role) as (
  values
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'admin',   'Demo Admin',      'admin'::public.app_role),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'cashier', 'Demo Cashier',    'cashier'),
    ('a0000000-0000-0000-0000-000000000003'::uuid, 'waiter1', 'Demo Waiter One', 'waiter'),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'waiter2', 'Demo Waiter Two', 'waiter'),
    ('a0000000-0000-0000-0000-000000000005'::uuid, 'chef',    'Demo Chef',       'chef'),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'rider',   'Demo Rider',      'rider')
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated',
    s.username || '@example.com',
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

-- Menu categories
insert into public.categories (id, name, sort_order) values
  ('c0000000-0000-0000-0000-000000000001', 'Starters', 1),
  ('c0000000-0000-0000-0000-000000000002', 'BBQ', 2),
  ('c0000000-0000-0000-0000-000000000003', 'Karahi & Curries', 3),
  ('c0000000-0000-0000-0000-000000000004', 'Rice', 4),
  ('c0000000-0000-0000-0000-000000000005', 'Breads', 5),
  ('c0000000-0000-0000-0000-000000000006', 'Drinks', 6);

-- Menu items. Prices and costs in paisa (65000 = Rs 650). Made-up demo prices.
-- Bottled and canned drinks have needs_kitchen = false (BR-07): they never reach the kitchen.
insert into public.menu_items (category_id, name, description, price, cost_price, prep_time_min,
                               needs_kitchen, is_available, sort_order)
select c.id, i.name, i.description, i.price, i.cost_price, i.prep_time_min, i.needs_kitchen,
       i.is_available, i.sort_order
from (values
  ('Starters', 'Chicken Corn Soup', 'Bowl, serves one', 45000, 15000, 8, true, true, 1),
  ('Starters', 'Vegetable Samosa (2 pcs)', 'Crisp pastry, spiced potato', 25000, 8000, 6, true, true, 2),
  ('Starters', 'Chicken Wings (6 pcs)', 'Fried, with dip', 65000, 26000, 12, true, true, 3),
  ('Starters', 'Fresh Garden Salad', 'Seasonal vegetables', 30000, 10000, 5, true, true, 4),
  ('Starters', 'Raita', 'Yoghurt with mint', 15000, 4000, 2, true, true, 5),

  ('BBQ', 'Chicken Tikka (Leg)', 'Charcoal grilled', 60000, 25000, 15, true, true, 1),
  ('BBQ', 'Seekh Kebab (4 pcs)', 'Minced beef skewers', 70000, 30000, 15, true, true, 2),
  ('BBQ', 'Chicken Malai Boti', 'Creamy marinated cubes', 85000, 36000, 15, true, true, 3),
  ('BBQ', 'Fish Tikka', 'Grilled fish cubes', 120000, 60000, 18, true, false, 4),
  ('BBQ', 'Mixed BBQ Platter', 'Tikka, kebab, boti; serves two', 220000, 95000, 20, true, true, 5),

  ('Karahi & Curries', 'Chicken Karahi (Half)', 'Tomato and green chilli', 140000, 60000, 20, true, true, 1),
  ('Karahi & Curries', 'Chicken Karahi (Full)', 'Tomato and green chilli', 260000, 110000, 25, true, true, 2),
  ('Karahi & Curries', 'Mutton Karahi (Half)', 'Slow cooked', 220000, 120000, 30, true, true, 3),
  ('Karahi & Curries', 'Daal Makhani', 'Black lentils, butter', 65000, 18000, 10, true, true, 4),
  ('Karahi & Curries', 'Palak Paneer', 'Spinach and cottage cheese', 85000, 30000, 12, true, true, 5),

  ('Rice', 'Chicken Biryani', 'Single serving', 55000, 22000, 5, true, true, 1),
  ('Rice', 'Vegetable Pulao', 'Single serving', 40000, 14000, 5, true, true, 2),
  ('Rice', 'Plain Rice', 'Steamed basmati', 25000, 7000, 3, true, true, 3),

  ('Breads', 'Plain Naan', null, 5000, 1500, 3, true, true, 1),
  ('Breads', 'Garlic Naan', null, 8000, 2500, 4, true, true, 2),
  ('Breads', 'Roghni Naan', 'Sesame topped', 7000, 2000, 4, true, true, 3),
  ('Breads', 'Tandoori Roti', null, 3000, 800, 3, true, true, 4),

  ('Drinks', 'Mineral Water (500 ml)', 'Bottled', 8000, 4000, null, false, true, 1),
  ('Drinks', 'Mineral Water (1.5 L)', 'Bottled', 15000, 8000, null, false, true, 2),
  ('Drinks', 'Soft Drink (Can)', 'Canned', 15000, 9000, null, false, true, 3),
  ('Drinks', 'Soft Drink (1.5 L)', 'Bottled', 30000, 18000, null, false, true, 4),
  ('Drinks', 'Mint Margarita', 'Blended, made fresh', 45000, 12000, 4, true, true, 5),
  ('Drinks', 'Sweet Lassi', 'Made fresh', 35000, 10000, 4, true, true, 6),
  ('Drinks', 'Doodh Patti Chai', 'Made fresh', 20000, 5000, 5, true, true, 7),
  ('Drinks', 'Fresh Lime Soda', 'Made fresh', 30000, 8000, 3, true, true, 8)
) as i(category, name, description, price, cost_price, prep_time_min, needs_kitchen,
       is_available, sort_order)
join public.categories c on c.name = i.category;

-- Tables: 8 in the Hall, 4 in the Family section.
insert into public.restaurant_tables (number, capacity, section)
select n, case when n in (3, 6) then 2 else 4 end, 'Hall' from generate_series(1, 8) as n
union all
select n, case when n = 12 then 8 else 6 end, 'Family' from generate_series(9, 12) as n;

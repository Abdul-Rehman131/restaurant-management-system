-- Demo data for a client demo on STAGING: `pnpm seed:staging -- --demo-data` calls
-- public.ops_demo_data, and supabase/seed.sql calls the same function locally, so the two can
-- never drift apart. Everything is clearly fake: the brand "Ember Kitchen (Demo)", made-up
-- prices, a demo address and footer. No real owner or business data.
--
-- Safe by construction:
-- - It only ADDS what is missing (categories, items and tables by name or number) and never
--   changes or archives an existing row, so a second run adds nothing.
-- - It refuses to run at all (OWNER_DATA_PRESENT, nothing changed) as soon as the branch has
--   anything that is not demo data: a category, item or table outside the demo set, or a
--   restaurant name other than the untouched default or the demo name. Real data is never
--   mixed with demo data.
-- - p_dry_run (the default) only reports what it would add.
-- service_role only: the script runs it with the secret key; no browser can call it.

-- The demo content, one place: (category, sort, name, description, price, cost, prep minutes,
-- needs kitchen, available, sort). Prices and costs in paisa (65000 = Rs 650). Bottled and
-- canned drinks skip the kitchen (BR-07); Fish Tikka starts Sold Out (BR-13).
create function private.demo_menu()
returns table (
  category text, category_sort integer, name text, description text, price bigint,
  cost_price bigint, prep_time_min integer, needs_kitchen boolean, is_available boolean,
  sort_order integer
)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('Starters', 1, 'Chicken Corn Soup', 'Bowl, serves one', 45000::bigint, 15000::bigint, 8, true, true, 1),
    ('Starters', 1, 'Vegetable Samosa (2 pcs)', 'Crisp pastry, spiced potato', 25000, 8000, 6, true, true, 2),
    ('Starters', 1, 'Chicken Wings (6 pcs)', 'Fried, with dip', 65000, 26000, 12, true, true, 3),
    ('Starters', 1, 'Fresh Garden Salad', 'Seasonal vegetables', 30000, 10000, 5, true, true, 4),
    ('Starters', 1, 'Raita', 'Yoghurt with mint', 15000, 4000, 2, true, true, 5),

    ('BBQ', 2, 'Chicken Tikka (Leg)', 'Charcoal grilled', 60000, 25000, 15, true, true, 1),
    ('BBQ', 2, 'Seekh Kebab (4 pcs)', 'Minced beef skewers', 70000, 30000, 15, true, true, 2),
    ('BBQ', 2, 'Chicken Malai Boti', 'Creamy marinated cubes', 85000, 36000, 15, true, true, 3),
    ('BBQ', 2, 'Fish Tikka', 'Grilled fish cubes', 120000, 60000, 18, true, false, 4),
    ('BBQ', 2, 'Mixed BBQ Platter', 'Tikka, kebab, boti; serves two', 220000, 95000, 20, true, true, 5),

    ('Karahi & Curries', 3, 'Chicken Karahi (Half)', 'Tomato and green chilli', 140000, 60000, 20, true, true, 1),
    ('Karahi & Curries', 3, 'Chicken Karahi (Full)', 'Tomato and green chilli', 260000, 110000, 25, true, true, 2),
    ('Karahi & Curries', 3, 'Mutton Karahi (Half)', 'Slow cooked', 220000, 120000, 30, true, true, 3),
    ('Karahi & Curries', 3, 'Daal Makhani', 'Black lentils, butter', 65000, 18000, 10, true, true, 4),
    ('Karahi & Curries', 3, 'Palak Paneer', 'Spinach and cottage cheese', 85000, 30000, 12, true, true, 5),

    ('Rice', 4, 'Chicken Biryani', 'Single serving', 55000, 22000, 5, true, true, 1),
    ('Rice', 4, 'Vegetable Pulao', 'Single serving', 40000, 14000, 5, true, true, 2),
    ('Rice', 4, 'Plain Rice', 'Steamed basmati', 25000, 7000, 3, true, true, 3),

    ('Breads', 5, 'Plain Naan', null, 5000, 1500, 3, true, true, 1),
    ('Breads', 5, 'Garlic Naan', null, 8000, 2500, 4, true, true, 2),
    ('Breads', 5, 'Roghni Naan', 'Sesame topped', 7000, 2000, 4, true, true, 3),
    ('Breads', 5, 'Tandoori Roti', null, 3000, 800, 3, true, true, 4),

    ('Drinks', 6, 'Mineral Water (500 ml)', 'Bottled', 8000, 4000, null, false, true, 1),
    ('Drinks', 6, 'Mineral Water (1.5 L)', 'Bottled', 15000, 8000, null, false, true, 2),
    ('Drinks', 6, 'Soft Drink (Can)', 'Canned', 15000, 9000, null, false, true, 3),
    ('Drinks', 6, 'Soft Drink (1.5 L)', 'Bottled', 30000, 18000, null, false, true, 4),
    ('Drinks', 6, 'Mint Margarita', 'Blended, made fresh', 45000, 12000, 4, true, true, 5),
    ('Drinks', 6, 'Sweet Lassi', 'Made fresh', 35000, 10000, 4, true, true, 6),
    ('Drinks', 6, 'Doodh Patti Chai', 'Made fresh', 20000, 5000, 5, true, true, 7),
    ('Drinks', 6, 'Fresh Lime Soda', 'Made fresh', 30000, 8000, 3, true, true, 8)
  ) as m(category, category_sort, name, description, price, cost_price, prep_time_min,
         needs_kitchen, is_available, sort_order)
$$;

-- Tables: 8 in the Hall (two for 2), 4 in the Family section (one for 8).
create function private.demo_tables()
returns table (number integer, capacity integer, section text)
language sql
immutable
set search_path = ''
as $$
  select n, case when n in (3, 6) then 2 else 4 end, 'Hall' from generate_series(1, 8) as n
  union all
  select n, case when n = 12 then 8 else 6 end, 'Family' from generate_series(9, 12) as n
$$;

create function public.ops_demo_data(p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_branch uuid := private.default_branch_id();
  v_name text;
  v_foreign jsonb;
  v_settings text;
  v_categories integer;
  v_items integer;
  v_tables integer;
begin
  -- One run at a time (two terminals): the second waits, then finds everything present.
  perform pg_advisory_xact_lock(hashtextextended('ops_demo_data', 0));

  select restaurant_name into v_name from public.settings where branch_id = v_branch for update;
  v_foreign := jsonb_build_object(
    'restaurant_name', v_name not in ('My Restaurant', 'Ember Kitchen (Demo)'),
    'categories', (select count(*) from public.categories c
                    where c.branch_id = v_branch and c.is_active
                      and lower(c.name) not in (select distinct lower(m.category) from private.demo_menu() m)),
    'menu_items', (select count(*) from public.menu_items i
                    where i.branch_id = v_branch and i.is_active
                      and lower(i.name) not in (select lower(m.name) from private.demo_menu() m)),
    'tables', (select count(*) from public.restaurant_tables t
                where t.branch_id = v_branch and t.is_active
                  and t.number not in (select d.number from private.demo_tables() d)));
  if (v_foreign ->> 'restaurant_name')::boolean
     or (v_foreign ->> 'categories')::integer > 0
     or (v_foreign ->> 'menu_items')::integer > 0
     or (v_foreign ->> 'tables')::integer > 0 then
    raise exception 'OWNER_DATA_PRESENT' using errcode = 'P0001', detail = v_foreign::text;
  end if;

  v_settings := case when v_name = 'My Restaurant' then 'set to demo' else 'already demo' end;
  select count(*) into v_categories from (select distinct m.category from private.demo_menu() m) d
   where not exists (select 1 from public.categories c
                      where c.branch_id = v_branch and c.is_active and lower(c.name) = lower(d.category));
  select count(*) into v_items from private.demo_menu() m
   where not exists (select 1 from public.menu_items i
                      where i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name));
  select count(*) into v_tables from private.demo_tables() d
   where not exists (select 1 from public.restaurant_tables t
                      where t.branch_id = v_branch and t.is_active and t.number = d.number);

  if not p_dry_run then
    if v_name = 'My Restaurant' then
      -- Demo brand and DEMO rates (16% tax, 5% service charge), labelled on every receipt.
      update public.settings
         set restaurant_name = 'Ember Kitchen (Demo)',
             address = 'Demo address, not a real location',
             phone = '+00 000 000 0000',
             receipt_footer = 'Demo receipt. Not a real business. Demo rates: 16% tax, 5% service.',
             tax_bps = 1600,
             service_charge_bps = 500
       where branch_id = v_branch;
    end if;

    insert into public.categories (branch_id, name, sort_order)
    select distinct v_branch, m.category, m.category_sort from private.demo_menu() m
     where not exists (select 1 from public.categories c
                        where c.branch_id = v_branch and c.is_active and lower(c.name) = lower(m.category));

    insert into public.menu_items (branch_id, category_id, name, description, price, cost_price,
                                   prep_time_min, needs_kitchen, is_available, sort_order)
    select v_branch, c.id, m.name, m.description, m.price, m.cost_price, m.prep_time_min,
           m.needs_kitchen, m.is_available, m.sort_order
      from private.demo_menu() m
      join public.categories c
        on c.branch_id = v_branch and c.is_active and lower(c.name) = lower(m.category)
     where not exists (select 1 from public.menu_items i
                        where i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name));

    insert into public.restaurant_tables (branch_id, number, capacity, section)
    select v_branch, d.number, d.capacity, d.section from private.demo_tables() d
     where not exists (select 1 from public.restaurant_tables t
                        where t.branch_id = v_branch and t.is_active and t.number = d.number);

    if v_settings = 'set to demo' or v_categories + v_items + v_tables > 0 then
      perform private.audit('demo.loaded', 'settings', v_branch, 'pnpm seed:staging --demo-data', null,
        jsonb_build_object('categories', v_categories, 'menu_items', v_items, 'tables', v_tables));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'settings', v_settings,
    'categories_added', v_categories,
    'menu_items_added', v_items,
    'tables_added', v_tables);
end;
$$;

comment on function public.ops_demo_data(boolean) is
  'Adds the clearly fake demo menu, tables and settings where missing; refuses if any non-demo data exists (OWNER_DATA_PRESENT). Dry run by default. service_role only.';

revoke all on function private.demo_menu() from public, anon, authenticated;
revoke all on function private.demo_tables() from public, anon, authenticated;
revoke all on function public.ops_demo_data(boolean) from public, anon, authenticated;
grant execute on function public.ops_demo_data(boolean) to service_role;

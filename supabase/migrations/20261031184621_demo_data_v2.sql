-- Demo data, version 2 (replaces the content of migration demo_data; that migration is not
-- edited). Used by supabase/seed.sql and `pnpm seed:staging --demo-data`, STAGING demo only.
-- Clearly fake: "Ember Kitchen (Demo)", a placeholder address and phone, demo rates named on the
-- receipt. Pakistani city restaurant, desi food and fast food, mid-range dine-in prices in
-- whole rupees (stored in paisa), cost prices about 30 to 40 percent. No photos.
--
-- Same guard as before: it refuses as a whole (OWNER_DATA_PRESENT, nothing changed) when the
-- branch has anything that is not demo data. The first demo set (version 1) counts as demo
-- data: its rows are brought to this version (items updated or archived, never deleted;
-- tables moved to the new sections), so a staging project seeded with version 1 upgrades.
-- Safe to run again: a second run changes nothing.

-- (category, category sort, name, description, price, cost, prep minutes, needs kitchen,
-- available, sort). needs_kitchen is false for bottled and canned drinks, water, packaged
-- desserts and anything not cooked (BR-07). Two items start Sold Out (BR-13).
create or replace function private.demo_menu()
returns table (
  category text, category_sort integer, name text, description text, price bigint,
  cost_price bigint, prep_time_min integer, needs_kitchen boolean, is_available boolean,
  sort_order integer
)
language sql
immutable
set search_path = ''
as $$
  select m.category, m.category_sort, m.name, m.description, m.rupees * 100, m.cost_rupees * 100,
         m.prep_time_min, m.needs_kitchen, m.is_available, m.sort_order
  from (values
    ('Starters', 1, 'Chicken Soup', 'Bowl, serves one', 450::bigint, 160::bigint, 8, true, true, 1),
    ('Starters', 1, 'Hot and Sour Soup', 'Bowl, serves one', 500, 180, 8, true, true, 2),
    ('Starters', 1, 'Chicken Wings (6 pcs)', 'Fried, with dip', 750, 280, 12, true, true, 3),
    ('Starters', 1, 'Fish Fingers (6 pcs)', 'With tartar sauce', 850, 320, 12, true, true, 4),

    ('BBQ and Tikka', 2, 'Chicken Tikka (Leg)', 'Charcoal grilled', 650, 240, 15, true, true, 1),
    ('BBQ and Tikka', 2, 'Chicken Tikka (Chest)', 'Charcoal grilled', 700, 260, 15, true, true, 2),
    ('BBQ and Tikka', 2, 'Chicken Malai Boti', 'Creamy marinated cubes', 950, 350, 15, true, true, 3),
    ('BBQ and Tikka', 2, 'Seekh Kabab (4 pcs)', 'Minced beef skewers', 700, 250, 15, true, true, 4),
    ('BBQ and Tikka', 2, 'Beef Bihari Boti', 'Tender, smoky', 1100, 420, 18, true, true, 5),
    ('BBQ and Tikka', 2, 'Reshmi Kabab (4 pcs)', 'Soft chicken mince', 900, 330, 15, true, true, 6),
    ('BBQ and Tikka', 2, 'Mutton Chops (4 pcs)', 'Charcoal grilled', 2200, 850, 20, true, false, 7),

    ('Karahi and Handi', 3, 'Chicken Karahi (Half)', 'Tomato and green chilli', 1500, 560, 20, true, true, 1),
    ('Karahi and Handi', 3, 'Chicken Karahi (Full)', 'Tomato and green chilli', 2800, 1050, 25, true, true, 2),
    ('Karahi and Handi', 3, 'Mutton Karahi (Half)', 'Slow cooked', 2600, 1000, 30, true, true, 3),
    ('Karahi and Handi', 3, 'Mutton Karahi (Full)', 'Slow cooked', 4900, 1900, 35, true, true, 4),
    ('Karahi and Handi', 3, 'Chicken Handi', 'Creamy, boneless', 1450, 520, 20, true, true, 5),
    ('Karahi and Handi', 3, 'Beef Nihari', 'Slow cooked overnight', 950, 350, 5, true, true, 6),
    ('Karahi and Handi', 3, 'Mutton Paya', 'Slow cooked trotters', 1100, 420, 5, true, true, 7),
    ('Karahi and Handi', 3, 'Daal Mash', 'White lentils, butter', 650, 200, 10, true, true, 8),

    ('Rice and Biryani', 4, 'Chicken Biryani', 'Single serving', 550, 200, 5, true, true, 1),
    ('Rice and Biryani', 4, 'Beef Pulao', 'Single serving', 650, 240, 5, true, true, 2),
    ('Rice and Biryani', 4, 'Chicken Pulao', 'Single serving', 550, 200, 5, true, true, 3),
    ('Rice and Biryani', 4, 'Plain Rice', 'Steamed basmati', 300, 90, 3, true, true, 4),
    ('Rice and Biryani', 4, 'Zeera Rice', 'Cumin rice', 350, 110, 3, true, true, 5),

    ('Naan and Roti', 5, 'Plain Naan', null, 60, 20, 3, true, true, 1),
    ('Naan and Roti', 5, 'Roghni Naan', 'Sesame topped', 90, 30, 4, true, true, 2),
    ('Naan and Roti', 5, 'Garlic Naan', null, 120, 40, 4, true, true, 3),
    ('Naan and Roti', 5, 'Tandoori Roti', null, 40, 12, 3, true, true, 4),
    ('Naan and Roti', 5, 'Paratha', null, 120, 40, 4, true, true, 5),
    ('Naan and Roti', 5, 'Kulcha', null, 100, 35, 4, true, true, 6),

    ('Burgers', 6, 'Zinger Burger', 'Crispy fillet, mayo', 750, 280, 10, true, true, 1),
    ('Burgers', 6, 'Chicken Burger', 'Grilled patty', 550, 200, 10, true, true, 2),
    ('Burgers', 6, 'Beef Burger', 'Beef patty, cheese', 850, 320, 12, true, true, 3),
    ('Burgers', 6, 'Double Zinger Burger', 'Two crispy fillets', 1100, 420, 12, true, true, 4),
    ('Burgers', 6, 'Crispy Chicken Burger', 'Crunchy coating', 650, 240, 10, true, true, 5),

    ('Pizza', 7, 'Fajita Pizza (Small)', null, 950, 340, 15, true, true, 1),
    ('Pizza', 7, 'Fajita Pizza (Large)', null, 1950, 700, 18, true, true, 2),
    ('Pizza', 7, 'Tikka Pizza (Small)', null, 950, 340, 15, true, true, 3),
    ('Pizza', 7, 'Tikka Pizza (Large)', null, 1950, 700, 18, true, true, 4),
    ('Pizza', 7, 'Pepperoni Pizza (Small)', null, 1050, 380, 15, true, true, 5),
    ('Pizza', 7, 'Pepperoni Pizza (Large)', null, 2150, 780, 18, true, true, 6),
    ('Pizza', 7, 'Cheese Lover Pizza (Small)', null, 1050, 390, 15, true, true, 7),
    ('Pizza', 7, 'Cheese Lover Pizza (Large)', null, 2150, 800, 18, true, true, 8),

    ('Fast Food and Wraps', 8, 'French Fries', 'Salted', 350, 110, 6, true, true, 1),
    ('Fast Food and Wraps', 8, 'Loaded Fries', 'Cheese and chicken', 750, 270, 8, true, true, 2),
    ('Fast Food and Wraps', 8, 'Chicken Nuggets (6 pcs)', 'With dip', 600, 220, 8, true, true, 3),
    ('Fast Food and Wraps', 8, 'Club Sandwich', 'With fries', 850, 310, 10, true, true, 4),
    ('Fast Food and Wraps', 8, 'Chicken Shawarma', 'Garlic sauce', 450, 160, 6, true, true, 5),
    ('Fast Food and Wraps', 8, 'Zinger Wrap', 'Crispy fillet, salad', 750, 280, 8, true, true, 6),
    ('Fast Food and Wraps', 8, 'Pasta Alfredo', 'Creamy chicken pasta', 1250, 450, 15, true, true, 7),
    ('Fast Food and Wraps', 8, 'Chicken Roll Paratha', 'With chutney', 450, 160, 8, true, true, 8),

    ('Sides', 9, 'Raita', 'Yoghurt with mint', 150, 45, null, false, true, 1),
    ('Sides', 9, 'Green Salad', 'Seasonal vegetables', 250, 80, null, false, true, 2),
    ('Sides', 9, 'Kachumber Salad', 'Tomato, onion, cucumber', 250, 80, null, false, true, 3),
    ('Sides', 9, 'Mint Chutney', null, 100, 30, null, false, true, 4),

    ('Desserts', 10, 'Kheer', 'Rice pudding', 350, 120, 3, true, true, 1),
    ('Desserts', 10, 'Gulab Jamun (2 pcs)', 'Served warm', 250, 80, 3, true, true, 2),
    ('Desserts', 10, 'Gajar Halwa', 'Seasonal', 450, 170, 3, true, false, 3),
    ('Desserts', 10, 'Ice Cream (2 scoops)', 'Packaged', 350, 130, null, false, true, 4),
    ('Desserts', 10, 'Brownie', 'Packaged', 450, 160, null, false, true, 5),

    ('Drinks', 11, 'Pepsi (Can)', 'Canned', 180, 72, null, false, true, 1),
    ('Drinks', 11, '7Up (Can)', 'Canned', 180, 72, null, false, true, 2),
    ('Drinks', 11, 'Mirinda (Can)', 'Canned', 180, 72, null, false, true, 3),
    ('Drinks', 11, 'Mineral Water (500 ml)', 'Bottled', 100, 40, null, false, true, 4),
    ('Drinks', 11, 'Mineral Water (1.5 L)', 'Bottled', 180, 72, null, false, true, 5),
    ('Drinks', 11, 'Fresh Lime', 'Sweet or salted', 250, 80, null, false, true, 6),
    ('Drinks', 11, 'Mint Margarita', 'Blended', 350, 110, null, false, true, 7),
    ('Drinks', 11, 'Sweet Lassi', null, 300, 100, null, false, true, 8),
    ('Drinks', 11, 'Salted Lassi', null, 300, 100, null, false, true, 9),
    ('Drinks', 11, 'Doodh Patti Chai', 'Brewed', 150, 45, 5, true, true, 10),
    ('Drinks', 11, 'Kashmiri Chai', 'Pink tea', 250, 85, 6, true, true, 11),
    ('Drinks', 11, 'Coffee', 'Hot', 350, 120, 4, true, true, 12)
  ) as m(category, category_sort, name, description, rupees, cost_rupees, prep_time_min,
         needs_kitchen, is_available, sort_order)
$$;

-- 14 tables: Hall 1 to 6, Family 7 to 11, Outdoor 12 to 14.
create or replace function private.demo_tables()
returns table (number integer, capacity integer, section text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    (1, 4, 'Hall'), (2, 4, 'Hall'), (3, 2, 'Hall'), (4, 2, 'Hall'), (5, 4, 'Hall'), (6, 6, 'Hall'),
    (7, 6, 'Family'), (8, 6, 'Family'), (9, 8, 'Family'), (10, 8, 'Family'), (11, 10, 'Family'),
    (12, 4, 'Outdoor'), (13, 4, 'Outdoor'), (14, 6, 'Outdoor')
  ) as t(number, capacity, section)
$$;

-- The first demo set's names (migration demo_data): demo data too, upgraded by this version.
create function private.demo_v1_names()
returns table (kind text, name text)
language sql
immutable
set search_path = ''
as $$
  select 'category', unnest(array['Starters', 'BBQ', 'Karahi & Curries', 'Rice', 'Breads', 'Drinks'])
  union all
  select 'item', unnest(array[
    'Chicken Corn Soup', 'Vegetable Samosa (2 pcs)', 'Chicken Wings (6 pcs)', 'Fresh Garden Salad',
    'Raita', 'Chicken Tikka (Leg)', 'Seekh Kebab (4 pcs)', 'Chicken Malai Boti', 'Fish Tikka',
    'Mixed BBQ Platter', 'Chicken Karahi (Half)', 'Chicken Karahi (Full)', 'Mutton Karahi (Half)',
    'Daal Makhani', 'Palak Paneer', 'Chicken Biryani', 'Vegetable Pulao', 'Plain Rice',
    'Plain Naan', 'Garlic Naan', 'Roghni Naan', 'Tandoori Roti', 'Mineral Water (500 ml)',
    'Mineral Water (1.5 L)', 'Soft Drink (Can)', 'Soft Drink (1.5 L)', 'Mint Margarita',
    'Sweet Lassi', 'Doodh Patti Chai', 'Fresh Lime Soda'])
$$;

revoke all on function private.demo_v1_names() from public, anon, authenticated;

-- Every demo name, lower case: this version's and the first version's (it upgrades those).
create function private.demo_known_names()
returns table (kind text, name text)
language sql
immutable
set search_path = ''
as $$
  select 'category', lower(m.category) from private.demo_menu() m
  union select 'item', lower(m.name) from private.demo_menu() m
  union select v.kind, lower(v.name) from private.demo_v1_names() v
$$;

revoke all on function private.demo_known_names() from public, anon, authenticated;

create or replace function public.ops_demo_data(p_dry_run boolean default true)
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
  v_updated integer;
  v_archived integer;
  v_tables integer;
  v_moved integer;
begin
  -- One run at a time (two terminals): the second waits, then finds everything present.
  perform pg_advisory_xact_lock(hashtextextended('ops_demo_data', 0));

  select restaurant_name into v_name from public.settings where branch_id = v_branch for update;
  v_foreign := jsonb_build_object(
    'restaurant_name', v_name not in ('My Restaurant', 'Ember Kitchen (Demo)'),
    'categories', (select count(*) from public.categories c
                    where c.branch_id = v_branch and c.is_active
                      and lower(c.name) not in (select k.name from private.demo_known_names() k where k.kind = 'category')),
    'menu_items', (select count(*) from public.menu_items i
                    where i.branch_id = v_branch and i.is_active
                      and lower(i.name) not in (select k.name from private.demo_known_names() k where k.kind = 'item')),
    'tables', (select count(*) from public.restaurant_tables t
                where t.branch_id = v_branch and t.is_active
                  and t.number not in (select d.number from private.demo_tables() d)));
  if (v_foreign ->> 'restaurant_name')::boolean
     or (v_foreign ->> 'categories')::integer > 0
     or (v_foreign ->> 'menu_items')::integer > 0
     or (v_foreign ->> 'tables')::integer > 0 then
    raise exception 'OWNER_DATA_PRESENT' using errcode = 'P0001', detail = v_foreign::text;
  end if;

  -- What would change.
  select case when exists (select 1 from public.settings s
                            where s.branch_id = v_branch
                              and s.restaurant_name = 'Ember Kitchen (Demo)'
                              and s.currency_code = 'PKR' and s.currency_minor_units = 2
                              and s.timezone = 'Asia/Karachi' and s.day_cutoff_time = '04:00'
                              and s.tax_bps = 1600 and s.service_charge_bps = 500
                              and s.address = 'Demo address, not a real location'
                              and s.phone = '+92 000 0000000'
                              and s.receipt_footer = 'Demo receipt. Not a real business. Demo rates: 16% tax, 5% service.')
              then 'already demo' else 'set to demo' end
    into v_settings;
  select count(*) into v_categories from (select distinct m.category from private.demo_menu() m) d
   where not exists (select 1 from public.categories c
                      where c.branch_id = v_branch and c.is_active and lower(c.name) = lower(d.category));
  select count(*) into v_items from private.demo_menu() m
   where not exists (select 1 from public.menu_items i
                      where i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name));
  select count(*) into v_updated
    from private.demo_menu() m
    join public.menu_items i on i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name)
    join public.categories c on c.id = i.category_id
   where lower(c.name) <> lower(m.category) or i.price <> m.price or i.cost_price is distinct from m.cost_price
      or i.description is distinct from m.description or i.needs_kitchen <> m.needs_kitchen
      or i.prep_time_min is distinct from m.prep_time_min or i.sort_order <> m.sort_order;
  select (select count(*) from public.menu_items i
           where i.branch_id = v_branch and i.is_active
             and lower(i.name) not in (select lower(m.name) from private.demo_menu() m))
       + (select count(*) from public.categories c
           where c.branch_id = v_branch and c.is_active
             and lower(c.name) not in (select lower(m.category) from private.demo_menu() m))
    into v_archived;
  select count(*) into v_tables from private.demo_tables() d
   where not exists (select 1 from public.restaurant_tables t
                      where t.branch_id = v_branch and t.is_active and t.number = d.number);
  select count(*) into v_moved
    from private.demo_tables() d
    join public.restaurant_tables t on t.branch_id = v_branch and t.is_active and t.number = d.number
   where t.section <> d.section or t.capacity <> d.capacity;

  if not p_dry_run then
    -- Demo brand, PKR, Karachi time, 04:00 cut-off, DEMO rates (16% tax, 5% service charge),
    -- named on every receipt.
    update public.settings
       set restaurant_name = 'Ember Kitchen (Demo)',
           address = 'Demo address, not a real location',
           phone = '+92 000 0000000',
           receipt_footer = 'Demo receipt. Not a real business. Demo rates: 16% tax, 5% service.',
           currency_code = 'PKR',
           currency_minor_units = 2,
           timezone = 'Asia/Karachi',
           day_cutoff_time = '04:00',
           tax_bps = 1600,
           service_charge_bps = 500
     where branch_id = v_branch and v_settings = 'set to demo';

    insert into public.categories (branch_id, name, sort_order)
    select distinct v_branch, m.category, m.category_sort from private.demo_menu() m
     where not exists (select 1 from public.categories c
                        where c.branch_id = v_branch and c.is_active and lower(c.name) = lower(m.category));
    update public.categories c
       set sort_order = d.category_sort
      from (select distinct m.category, m.category_sort from private.demo_menu() m) d
     where c.branch_id = v_branch and c.is_active and lower(c.name) = lower(d.category)
       and c.sort_order <> d.category_sort;

    -- Version 1 items that stay: moved to their new category, with the new price and details.
    -- Availability is left as the staff set it.
    update public.menu_items i
       set category_id = c.id, price = m.price, cost_price = m.cost_price,
           description = m.description, needs_kitchen = m.needs_kitchen,
           prep_time_min = m.prep_time_min, sort_order = m.sort_order
      from private.demo_menu() m
      join public.categories c
        on c.branch_id = v_branch and c.is_active and lower(c.name) = lower(m.category)
     where i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name)
       and (i.category_id <> c.id or i.price <> m.price or i.cost_price is distinct from m.cost_price
            or i.description is distinct from m.description or i.needs_kitchen <> m.needs_kitchen
            or i.prep_time_min is distinct from m.prep_time_min or i.sort_order <> m.sort_order);

    insert into public.menu_items (branch_id, category_id, name, description, price, cost_price,
                                   prep_time_min, needs_kitchen, is_available, sort_order)
    select v_branch, c.id, m.name, m.description, m.price, m.cost_price, m.prep_time_min,
           m.needs_kitchen, m.is_available, m.sort_order
      from private.demo_menu() m
      join public.categories c
        on c.branch_id = v_branch and c.is_active and lower(c.name) = lower(m.category)
     where not exists (select 1 from public.menu_items i
                        where i.branch_id = v_branch and i.is_active and lower(i.name) = lower(m.name));

    -- Version 1 items and categories that are gone: archived, never deleted (old orders keep them).
    update public.menu_items i set is_active = false
     where i.branch_id = v_branch and i.is_active
       and lower(i.name) not in (select lower(m.name) from private.demo_menu() m);
    update public.categories c set is_active = false
     where c.branch_id = v_branch and c.is_active
       and lower(c.name) not in (select lower(m.category) from private.demo_menu() m);

    insert into public.restaurant_tables (branch_id, number, capacity, section)
    select v_branch, d.number, d.capacity, d.section from private.demo_tables() d
     where not exists (select 1 from public.restaurant_tables t
                        where t.branch_id = v_branch and t.is_active and t.number = d.number);
    update public.restaurant_tables t
       set section = d.section, capacity = d.capacity
      from private.demo_tables() d
     where t.branch_id = v_branch and t.is_active and t.number = d.number
       and (t.section <> d.section or t.capacity <> d.capacity);

    if v_settings = 'set to demo' or v_categories + v_items + v_updated + v_archived + v_tables + v_moved > 0 then
      perform private.audit('demo.loaded', 'settings', v_branch, 'pnpm seed:staging --demo-data', null,
        jsonb_build_object('categories', v_categories, 'menu_items', v_items,
                           'menu_items_updated', v_updated, 'archived', v_archived,
                           'tables', v_tables, 'tables_moved', v_moved));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'settings', v_settings,
    'categories_added', v_categories,
    'menu_items_added', v_items,
    'menu_items_updated', v_updated,
    'archived', v_archived,
    'tables_added', v_tables,
    'tables_updated', v_moved);
end;
$$;

comment on function public.ops_demo_data(boolean) is
  'Demo menu (version 2), tables and settings: adds what is missing and upgrades the first demo set; refuses if any non-demo data exists (OWNER_DATA_PRESENT). Dry run by default. service_role only.';

-- Menu and categories for the Admin (M2, S5). Every function: Admin only (with aal2, see
-- s5_admin_requires_aal2), request id replay (BR-15), all checks before the first write.
--
--   admin_menu                 every category and item, archived too, with cost_price
--   save_category              create (p_category_id NULL) or rename
--   reorder_categories         sort_order of all active categories, in the order given
--   set_category_active        archive (reason required, refused while it has active items)
--                              or restore (BR-14: never deleted)
--   save_menu_item             create (p_menu_item_id NULL) or edit, the whole item at once
--   reorder_menu_items         sort_order of the active items of one category
--   set_menu_item_active       archive (reason required) or restore
--
-- A price change applies to new orders only: order lines keep their snapshot (BR-02). It is
-- audited by the S1 trigger (menu_item.price_changed); archives and restores by the trigger
-- below (category.archived, menu_item.restored, ...). Every change reaches the ordering
-- screens through the S1 menu broadcast (staff:menu).
--
-- Photos: image_path is "items/<uuid>.webp" in the menu-images bucket (s5_menu_images); the
-- object must already be uploaded. Old photos are kept in the bucket (no delete policy).

-- One item as the Admin sees it.
create function private.admin_menu_item(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'category_id', m.category_id, 'name', m.name, 'description', m.description,
    'price', m.price, 'cost_price', m.cost_price, 'prep_time_min', m.prep_time_min,
    'needs_kitchen', m.needs_kitchen, 'is_available', m.is_available, 'image_path', m.image_path,
    'sort_order', m.sort_order, 'is_active', m.is_active, 'updated_at', m.updated_at)
    from public.menu_items m
   where m.id = p_id
$$;

create function private.admin_category(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'sort_order', c.sort_order, 'is_active', c.is_active,
    'active_items', (select count(*) from public.menu_items m where m.category_id = c.id and m.is_active))
    from public.categories c
   where c.id = p_id
$$;

-- admin_menu: {categories: [...], items: [...]}, archived rows included, sorted for display.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501).
create function public.admin_menu()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(private.admin_category(c.id) order by c.is_active desc, c.sort_order, c.name)
        from public.categories c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.admin_menu_item(m.id) order by m.is_active desc, m.sort_order, m.name)
        from public.menu_items m), '[]'::jsonb)
  );
end;
$$;

-- A category name: trimmed, 1 to 60 characters. Errors: CATEGORY_NAME_INVALID.
create function private.category_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null or length(v_name) > 60 then
    raise exception 'CATEGORY_NAME_INVALID' using errcode = 'P0001';
  end if;
  return v_name;
end;
$$;

-- save_category: returns {category: {...}, created, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   CATEGORY_NAME_INVALID, CATEGORY_NAME_TAKEN, CATEGORY_NOT_FOUND, CATEGORY_ARCHIVED.
create function public.save_category(p_request_id uuid, p_category_id uuid, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_name text;
  v_id uuid := p_category_id;
  v_active boolean;
begin
  perform private.require_role('admin');
  v_replay := private.replay('save_category', p_request_id, p_category_id,
    jsonb_build_object('name', p_name));
  if v_replay is not null then
    return v_replay;
  end if;

  v_name := private.category_name(p_name);
  if v_id is not null then
    select c.is_active into v_active from public.categories c where c.id = v_id for update;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not v_active then
      raise exception 'CATEGORY_ARCHIVED' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.categories c
              where c.is_active and lower(c.name) = lower(v_name) and c.id is distinct from v_id) then
    raise exception 'CATEGORY_NAME_TAKEN' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.categories (name, sort_order)
    values (v_name, coalesce((select max(c.sort_order) from public.categories c where c.is_active), 0) + 10)
    returning id into v_id;
  else
    update public.categories set name = v_name where id = v_id and name is distinct from v_name;
  end if;

  return private.remember('save_category', p_request_id, p_category_id,
    jsonb_build_object('category', private.admin_category(v_id), 'created', p_category_id is null),
    jsonb_build_object('name', p_name));
end;
$$;

-- reorder_categories: p_category_ids must be every active category exactly once; their
-- sort_order becomes 10, 20, 30, ... in that order. Returns {category_ids, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   SORT_LIST_INVALID.
create function public.reorder_categories(p_request_id uuid, p_category_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('ids', to_jsonb(p_category_ids));
  v_replay jsonb;
begin
  perform private.require_role('admin');
  v_replay := private.replay('reorder_categories', p_request_id, null, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  perform 1 from public.categories c where c.is_active for update;
  if p_category_ids is null
     or cardinality(p_category_ids) <> (select count(distinct x) from unnest(p_category_ids) x)
     or (select array_agg(c.id order by c.id) from public.categories c where c.is_active)
        is distinct from (select array_agg(x order by x) from unnest(p_category_ids) x) then
    raise exception 'SORT_LIST_INVALID' using errcode = 'P0001';
  end if;

  update public.categories c
     set sort_order = o.position * 10
    from unnest(p_category_ids) with ordinality as o(id, position)
   where c.id = o.id and c.sort_order is distinct from o.position * 10;

  return private.remember('reorder_categories', p_request_id, null,
    jsonb_build_object('category_ids', to_jsonb(p_category_ids)), v_args);
end;
$$;

-- set_category_active: archive or restore. Returns {category: {...}, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   ACTIVE_REQUIRED, CATEGORY_NOT_FOUND, REASON_REQUIRED, REASON_TOO_LONG, CATEGORY_HAS_ITEMS,
--   CATEGORY_NAME_TAKEN.
create function public.set_category_active(
  p_request_id uuid,
  p_category_id uuid,
  p_is_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('is_active', p_is_active, 'reason', p_reason);
  v_replay jsonb;
  c public.categories%rowtype;
  v_reason text;
begin
  perform private.require_role('admin');
  v_replay := private.replay('set_category_active', p_request_id, p_category_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if p_is_active is null then
    raise exception 'ACTIVE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into c from public.categories where id = p_category_id for update;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_is_active then
    v_reason := private.clean_text(p_reason, 300, 'REASON_TOO_LONG');
    if not c.is_active then
      if exists (select 1 from public.categories x where x.is_active and lower(x.name) = lower(c.name)) then
        raise exception 'CATEGORY_NAME_TAKEN' using errcode = 'P0001';
      end if;
      perform private.set_audit_reason(v_reason);
      update public.categories
         set is_active = true,
             sort_order = coalesce((select max(x.sort_order) from public.categories x where x.is_active), 0) + 10
       where id = c.id;
    end if;
  else
    v_reason := private.require_reason(p_reason);
    if c.is_active then
      if exists (select 1 from public.menu_items m where m.category_id = c.id and m.is_active) then
        raise exception 'CATEGORY_HAS_ITEMS' using errcode = 'P0001';
      end if;
      perform private.set_audit_reason(v_reason);
      update public.categories set is_active = false where id = c.id;
    end if;
  end if;

  return private.remember('set_category_active', p_request_id, p_category_id,
    jsonb_build_object('category', private.admin_category(c.id)), v_args);
end;
$$;

-- save_menu_item: p_item = {category_id, name, description, price, cost_price, prep_time_min,
-- needs_kitchen, is_available, image_path}; category_id, name and price are required, the rest
-- default (no description, cost 0, no prep time, needs kitchen, available, no photo). An edit
-- sends the whole item. Money in minor units (hard rule 5). Returns {item: {...}, created,
-- replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   ITEM_INVALID, ITEM_FIELD_NOT_ALLOWED, ITEM_NOT_FOUND, CATEGORY_NOT_FOUND, ITEM_NAME_INVALID,
--   ITEM_NAME_TAKEN, DESCRIPTION_INVALID, PRICE_INVALID, PREP_TIME_INVALID, ITEM_FLAG_INVALID,
--   IMAGE_INVALID, IMAGE_NOT_FOUND.
create function public.save_menu_item(p_request_id uuid, p_menu_item_id uuid, p_item jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_id uuid := p_menu_item_id;
  v_old public.menu_items%rowtype;
  v_category uuid;
  v_name text;
  v_description text;
  v_price bigint;
  v_cost bigint;
  v_prep smallint;
  v_needs_kitchen boolean := true;
  v_available boolean := true;
  v_image text;
  v_sort integer;
begin
  perform private.require_role('admin');
  v_replay := private.replay('save_menu_item', p_request_id, p_menu_item_id, p_item);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.check_json_object(p_item, array[
    'category_id', 'name', 'description', 'price', 'cost_price', 'prep_time_min',
    'needs_kitchen', 'is_available', 'image_path'
  ], 'ITEM_INVALID', 'ITEM_FIELD_NOT_ALLOWED');

  if v_id is not null then
    select * into v_old from public.menu_items where id = v_id and is_active for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  v_category := private.json_uuid(p_item, 'category_id', 'CATEGORY_NOT_FOUND');
  perform 1 from public.categories c where c.id = v_category and c.is_active for share;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_name := private.json_text(p_item, 'name', 80, 'ITEM_NAME_INVALID');
  if v_name is null then
    raise exception 'ITEM_NAME_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.menu_items m
              where m.is_active and lower(m.name) = lower(v_name) and m.id is distinct from v_id) then
    raise exception 'ITEM_NAME_TAKEN' using errcode = 'P0001';
  end if;

  v_description := private.json_text(p_item, 'description', 500, 'DESCRIPTION_INVALID');
  v_price := private.json_int(p_item, 'price', 0, 100000000000, 'PRICE_INVALID');
  v_cost := case when p_item ? 'cost_price' and jsonb_typeof(p_item -> 'cost_price') <> 'null'
                 then private.json_int(p_item, 'cost_price', 0, 100000000000, 'PRICE_INVALID')
                 else 0 end;
  v_prep := case when p_item ? 'prep_time_min' and jsonb_typeof(p_item -> 'prep_time_min') <> 'null'
                 then private.json_int(p_item, 'prep_time_min', 0, 240, 'PREP_TIME_INVALID')
                 end;
  if p_item ? 'needs_kitchen' then
    v_needs_kitchen := private.json_bool(p_item, 'needs_kitchen', 'ITEM_FLAG_INVALID');
  end if;
  if p_item ? 'is_available' then
    v_available := private.json_bool(p_item, 'is_available', 'ITEM_FLAG_INVALID');
  end if;

  v_image := private.json_text(p_item, 'image_path', 300, 'IMAGE_INVALID');
  if v_image is not null then
    if v_image !~ '^items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
      raise exception 'IMAGE_INVALID' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'menu-images' and o.name = v_image) then
      raise exception 'IMAGE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  -- A new item, or one moved to another category, goes to the end of its category.
  if v_id is null or v_old.category_id <> v_category then
    v_sort := coalesce((select max(m.sort_order) from public.menu_items m
                         where m.category_id = v_category and m.is_active), 0) + 10;
  else
    v_sort := v_old.sort_order;
  end if;

  if v_id is null then
    insert into public.menu_items (category_id, name, description, price, cost_price,
                                   prep_time_min, needs_kitchen, is_available, image_path, sort_order)
    values (v_category, v_name, v_description, v_price, v_cost, v_prep, v_needs_kitchen,
            v_available, v_image, v_sort)
    returning id into v_id;
  else
    update public.menu_items
       set category_id = v_category, name = v_name, description = v_description, price = v_price,
           cost_price = v_cost, prep_time_min = v_prep, needs_kitchen = v_needs_kitchen,
           is_available = v_available, image_path = v_image, sort_order = v_sort
     where id = v_id
       and (category_id, name, description, price, cost_price, prep_time_min, needs_kitchen,
            is_available, image_path, sort_order)
           is distinct from
           (v_category, v_name, v_description, v_price, v_cost, v_prep, v_needs_kitchen,
            v_available, v_image, v_sort);
  end if;

  return private.remember('save_menu_item', p_request_id, p_menu_item_id,
    jsonb_build_object('item', private.admin_menu_item(v_id), 'created', p_menu_item_id is null),
    p_item);
end;
$$;

-- reorder_menu_items: p_item_ids must be every active item of the category exactly once.
-- Returns {category_id, item_ids, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   CATEGORY_NOT_FOUND, SORT_LIST_INVALID.
create function public.reorder_menu_items(p_request_id uuid, p_category_id uuid, p_item_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('ids', to_jsonb(p_item_ids));
  v_replay jsonb;
begin
  perform private.require_role('admin');
  v_replay := private.replay('reorder_menu_items', p_request_id, p_category_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  perform 1 from public.categories c where c.id = p_category_id and c.is_active;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from public.menu_items m where m.category_id = p_category_id and m.is_active for update;
  if p_item_ids is null
     or cardinality(p_item_ids) <> (select count(distinct x) from unnest(p_item_ids) x)
     or (select array_agg(m.id order by m.id) from public.menu_items m
          where m.category_id = p_category_id and m.is_active)
        is distinct from (select array_agg(x order by x) from unnest(p_item_ids) x) then
    raise exception 'SORT_LIST_INVALID' using errcode = 'P0001';
  end if;

  update public.menu_items m
     set sort_order = o.position * 10
    from unnest(p_item_ids) with ordinality as o(id, position)
   where m.id = o.id and m.sort_order is distinct from o.position * 10;

  return private.remember('reorder_menu_items', p_request_id, p_category_id,
    jsonb_build_object('category_id', p_category_id, 'item_ids', to_jsonb(p_item_ids)), v_args);
end;
$$;

-- set_menu_item_active: archive (it leaves every ordering screen; old orders keep their lines,
-- BR-02, BR-14) or restore (its category must be active and its name free). Returns
-- {item: {...}, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   ACTIVE_REQUIRED, ITEM_NOT_FOUND, REASON_REQUIRED, REASON_TOO_LONG, CATEGORY_ARCHIVED,
--   ITEM_NAME_TAKEN.
create function public.set_menu_item_active(
  p_request_id uuid,
  p_menu_item_id uuid,
  p_is_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('is_active', p_is_active, 'reason', p_reason);
  v_replay jsonb;
  m public.menu_items%rowtype;
  v_reason text;
begin
  perform private.require_role('admin');
  v_replay := private.replay('set_menu_item_active', p_request_id, p_menu_item_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if p_is_active is null then
    raise exception 'ACTIVE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into m from public.menu_items where id = p_menu_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_is_active then
    v_reason := private.clean_text(p_reason, 300, 'REASON_TOO_LONG');
    if not m.is_active then
      if not exists (select 1 from public.categories c where c.id = m.category_id and c.is_active) then
        raise exception 'CATEGORY_ARCHIVED' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.menu_items x where x.is_active and lower(x.name) = lower(m.name)) then
        raise exception 'ITEM_NAME_TAKEN' using errcode = 'P0001';
      end if;
      perform private.set_audit_reason(v_reason);
      update public.menu_items
         set is_active = true,
             sort_order = coalesce((select max(x.sort_order) from public.menu_items x
                                     where x.category_id = m.category_id and x.is_active), 0) + 10
       where id = m.id;
    end if;
  else
    v_reason := private.require_reason(p_reason);
    if m.is_active then
      perform private.set_audit_reason(v_reason);
      update public.menu_items set is_active = false where id = m.id;
    end if;
  end if;

  return private.remember('set_menu_item_active', p_request_id, p_menu_item_id,
    jsonb_build_object('item', private.admin_menu_item(m.id)), v_args);
end;
$$;

create trigger categories_audit_archive
  after update of is_active on public.categories
  for each row execute function private.audit_archive('category');
create trigger menu_items_audit_archive
  after update of is_active on public.menu_items
  for each row execute function private.audit_archive('menu_item');

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.admin_menu() from public, anon;
revoke all on function public.save_category(uuid, uuid, text) from public, anon;
revoke all on function public.reorder_categories(uuid, uuid[]) from public, anon;
revoke all on function public.set_category_active(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.save_menu_item(uuid, uuid, jsonb) from public, anon;
revoke all on function public.reorder_menu_items(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.set_menu_item_active(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_menu() to authenticated;
grant execute on function public.save_category(uuid, uuid, text) to authenticated;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated;
grant execute on function public.set_category_active(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.save_menu_item(uuid, uuid, jsonb) to authenticated;
grant execute on function public.reorder_menu_items(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.set_menu_item_active(uuid, uuid, boolean, text) to authenticated;

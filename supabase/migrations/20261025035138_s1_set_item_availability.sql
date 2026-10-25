-- set_item_availability (M2, M6, BR-13): Sold Out toggle. Marking an item Sold Out hides it
-- from ordering on every screen (create_order and add_items_to_order refuse it, the menu
-- broadcast tells the screens); existing orders keep their lines. Archived items
-- (is_active = false, BR-14) cannot be toggled. Pattern: docs/adr/001.
-- Returns {menu_item_id, is_available, replayed}.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ITEM_NOT_FOUND, AVAILABILITY_REQUIRED.
create function public.set_item_availability(
  p_request_id uuid,
  p_menu_item_id uuid,
  p_is_available boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('is_available', p_is_available);
  v_replay jsonb;
begin
  perform private.require_role('admin', 'cashier', 'chef');
  v_replay := private.replay('set_item_availability', p_request_id, p_menu_item_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if p_is_available is null then
    raise exception 'AVAILABILITY_REQUIRED' using errcode = 'P0001';
  end if;
  perform 1 from public.menu_items where id = p_menu_item_id and is_active for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.menu_items set is_available = p_is_available
   where id = p_menu_item_id and is_available is distinct from p_is_available;

  return private.remember('set_item_availability', p_request_id, p_menu_item_id,
    jsonb_build_object('menu_item_id', p_menu_item_id, 'is_available', p_is_available), v_args);
end;
$$;

comment on function public.set_item_availability(uuid, uuid, boolean) is
  'Sold Out toggle for an active menu item (BR-13, BR-15). See ADR 001.';

revoke all on function public.set_item_availability(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_item_availability(uuid, uuid, boolean) to authenticated;

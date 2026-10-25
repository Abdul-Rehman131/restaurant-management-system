-- move_order_table (M3, G12; ADR 002 / plan section 5 requirement 3): moves an open Dine-In
-- order to another table and/or hands it to another waiter, in one call.
--   * Table: Admin, Cashier, Waiter (own orders). The target must be active and free
--     (BR-05). The old table becomes Available; the new one takes over its status
--     (Occupied or Bill Requested). G13: table status is written only by order functions.
--   * Waiter: Admin and Cashier only; must name an active waiter. A waiter may "name"
--     only self (a no-op).
-- At least one of the two must be given. Both changes are written to the audit log by a
-- trigger. Tables are locked in id order so two moves never deadlock.
-- Pattern: docs/adr/001-business-logic-in-postgres.md.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, MOVE_NOTHING_TO_CHANGE, ORDER_NOT_FOUND, ORDER_CLOSED,
--   MOVE_DINE_IN_ONLY, TABLE_SAME, TABLE_NOT_FOUND, TABLE_HAS_OPEN_ORDER, WAITER_INVALID.
create function public.move_order_table(
  p_request_id uuid,
  p_order_id uuid,
  p_to_table_id uuid default null,
  p_waiter_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter');
  v_args jsonb := jsonb_build_object('to_table_id', p_to_table_id, 'waiter_id', p_waiter_id);
  v_replay jsonb;
  v_order public.orders%rowtype;
  v_from_status public.table_status;
  v_target public.restaurant_tables%rowtype;
begin
  if p_waiter_id is not null and v_role = 'waiter' and p_waiter_id <> auth.uid() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_replay := private.replay('move_order_table', p_request_id, p_order_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_to_table_id is null and p_waiter_id is null then
    raise exception 'MOVE_NOTHING_TO_CHANGE' using errcode = 'P0001';
  end if;

  v_order := private.lock_open_order(p_order_id, v_role);
  if v_order.type <> 'dine_in' then
    raise exception 'MOVE_DINE_IN_ONLY' using errcode = 'P0001';
  end if;

  if p_to_table_id is not null then
    if p_to_table_id = v_order.table_id then
      raise exception 'TABLE_SAME' using errcode = 'P0001';
    end if;
    -- Lock both tables in id order (create_order locks the target table too).
    perform 1 from public.restaurant_tables
      where id in (v_order.table_id, p_to_table_id) order by id for update;
    select * into v_target from public.restaurant_tables where id = p_to_table_id;
    if not found or not v_target.is_active then
      raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orders o
       where o.table_id = p_to_table_id and o.status not in ('completed', 'cancelled')
    ) then
      raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001';
    end if;
  end if;

  if p_waiter_id is not null
     and not private.has_active_role(p_waiter_id, array['waiter']::public.app_role[]) then
    raise exception 'WAITER_INVALID' using errcode = 'P0001';
  end if;

  if p_to_table_id is not null then
    select status into v_from_status from public.restaurant_tables where id = v_order.table_id;
    update public.orders set table_id = p_to_table_id where id = p_order_id;
    update public.restaurant_tables set status = 'available' where id = v_order.table_id;
    update public.restaurant_tables set status = v_from_status where id = p_to_table_id;
  end if;
  if p_waiter_id is not null then
    update public.orders set waiter_id = p_waiter_id
     where id = p_order_id and waiter_id is distinct from p_waiter_id;
  end if;

  return private.remember('move_order_table', p_request_id, p_order_id,
    private.order_summary(p_order_id, false), v_args);
end;
$$;

comment on function public.move_order_table(uuid, uuid, uuid, uuid) is
  'Moves an open Dine-In order to a free table and/or hands it to another waiter (G12, BR-05, BR-15). See ADR 001.';

revoke all on function public.move_order_table(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_order_table(uuid, uuid, uuid, uuid) to authenticated;

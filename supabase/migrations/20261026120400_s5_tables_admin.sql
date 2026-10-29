-- Restaurant tables for the Admin (M3, S5). Admin only (with aal2), request id replay
-- (BR-15). The table status stays with the order functions (G13); these functions never
-- change it.
--
--   save_table          create (p_table_id NULL) or edit number, capacity and section. Active
--                       numbers are unique (TABLE_NUMBER_TAKEN).
--   set_table_active    archive (reason required; refused while the table has an open order,
--                       BR-05) or restore (its number must be free).
-- Archives and restores are audited (restaurant_table.archived / .restored, BR-24); every
-- change reaches the waiter and cashier screens through the S1 table broadcast.

create function private.admin_table(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'capacity', t.capacity, 'section', t.section,
    'status', t.status, 'is_active', t.is_active)
    from public.restaurant_tables t
   where t.id = p_id
$$;

-- save_table: returns {table: {...}, created, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   TABLE_NOT_FOUND, TABLE_NUMBER_INVALID, TABLE_NUMBER_TAKEN, CAPACITY_INVALID, SECTION_INVALID.
create function public.save_table(
  p_request_id uuid,
  p_table_id uuid,
  p_number integer,
  p_capacity integer,
  p_section text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('number', p_number, 'capacity', p_capacity, 'section', p_section);
  v_replay jsonb;
  v_id uuid := p_table_id;
  v_section text;
begin
  perform private.require_role('admin');
  v_replay := private.replay('save_table', p_request_id, p_table_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if v_id is not null then
    perform 1 from public.restaurant_tables t where t.id = v_id and t.is_active for update;
    if not found then
      raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  if p_number is null or p_number < 1 or p_number > 999 then
    raise exception 'TABLE_NUMBER_INVALID' using errcode = 'P0001';
  end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 50 then
    raise exception 'CAPACITY_INVALID' using errcode = 'P0001';
  end if;
  v_section := nullif(btrim(p_section), '');
  if v_section is null or length(v_section) > 40 then
    raise exception 'SECTION_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.restaurant_tables t
              where t.is_active and t.number = p_number and t.id is distinct from v_id) then
    raise exception 'TABLE_NUMBER_TAKEN' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.restaurant_tables (number, capacity, section)
    values (p_number, p_capacity, v_section)
    returning id into v_id;
  else
    update public.restaurant_tables
       set number = p_number, capacity = p_capacity, section = v_section
     where id = v_id and (number, capacity, section) is distinct from (p_number, p_capacity, v_section);
  end if;

  return private.remember('save_table', p_request_id, p_table_id,
    jsonb_build_object('table', private.admin_table(v_id), 'created', p_table_id is null), v_args);
end;
$$;

-- set_table_active: returns {table: {...}, replayed}.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT,
--   ACTIVE_REQUIRED, TABLE_NOT_FOUND, REASON_REQUIRED, REASON_TOO_LONG, TABLE_HAS_OPEN_ORDER,
--   TABLE_NUMBER_TAKEN.
create function public.set_table_active(
  p_request_id uuid,
  p_table_id uuid,
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
  t public.restaurant_tables%rowtype;
  v_reason text;
begin
  perform private.require_role('admin');
  v_replay := private.replay('set_table_active', p_request_id, p_table_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if p_is_active is null then
    raise exception 'ACTIVE_REQUIRED' using errcode = 'P0001';
  end if;
  -- The same lock the order functions take, so no order can open on it meanwhile.
  select * into t from public.restaurant_tables where id = p_table_id for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_is_active then
    v_reason := private.clean_text(p_reason, 300, 'REASON_TOO_LONG');
    if not t.is_active then
      if exists (select 1 from public.restaurant_tables x where x.is_active and x.number = t.number) then
        raise exception 'TABLE_NUMBER_TAKEN' using errcode = 'P0001';
      end if;
      perform private.set_audit_reason(v_reason);
      update public.restaurant_tables set is_active = true where id = t.id;
    end if;
  else
    v_reason := private.require_reason(p_reason);
    if t.is_active then
      if exists (select 1 from public.orders o
                  where o.table_id = t.id and o.status not in ('completed', 'cancelled')) then
        raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001';
      end if;
      perform private.set_audit_reason(v_reason);
      update public.restaurant_tables set is_active = false where id = t.id;
    end if;
  end if;

  return private.remember('set_table_active', p_request_id, p_table_id,
    jsonb_build_object('table', private.admin_table(t.id)), v_args);
end;
$$;

create trigger restaurant_tables_audit_archive
  after update of is_active on public.restaurant_tables
  for each row execute function private.audit_archive('restaurant_table');

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.save_table(uuid, uuid, integer, integer, text) from public, anon;
revoke all on function public.set_table_active(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.save_table(uuid, uuid, integer, integer, text) to authenticated;
grant execute on function public.set_table_active(uuid, uuid, boolean, text) to authenticated;

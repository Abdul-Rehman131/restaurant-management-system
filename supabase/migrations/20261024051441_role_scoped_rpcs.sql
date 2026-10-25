-- Role-scoped read RPCs (T5): the only way to read data whose columns depend on the role.
-- All are SECURITY DEFINER (they read past RLS and column grants) and start with
-- private.require_role(), which reads the role from profiles: deactivated staff are refused.

-- Raises NOT_AUTHORIZED unless the caller is active staff with one of the given roles.
-- Returns the caller's role. Every business function starts with this check (P1 too).
create function private.require_role(variadic p_roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.my_role();
begin
  if v_role is null or not v_role = any (p_roles) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Settings for the caller's role. Business values for the UI (restaurant name, currency,
-- receipt footer) come from here, never from code.
--   display     (admin, cashier, waiter, chef): name, currency, time zone
--   operations  (admin, cashier, waiter, chef): business-day cut-off, kitchen age thresholds
--   contact     (admin, cashier, waiter):       address, phone, receipt footer
--   pricing     (admin, cashier):               rates and the Q1 pricing rules
--   rider: nothing until P3 (plan T5 matrix).
create function public.get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier', 'waiter', 'chef');
  s public.settings%rowtype;
  v_result jsonb;
begin
  select * into s from public.settings where branch_id = private.default_branch_id();

  v_result := jsonb_build_object(
    'restaurant_name', s.restaurant_name,
    'currency_code', s.currency_code,
    'currency_minor_units', s.currency_minor_units,
    'timezone', s.timezone,
    'day_cutoff_time', s.day_cutoff_time,
    'kitchen_warn_min', s.kitchen_warn_min,
    'kitchen_late_min', s.kitchen_late_min
  );

  if v_role in ('admin', 'cashier', 'waiter') then
    v_result := v_result || jsonb_build_object(
      'address', s.address,
      'phone', s.phone,
      'receipt_footer', s.receipt_footer
    );
  end if;

  if v_role in ('admin', 'cashier') then
    v_result := v_result || jsonb_build_object(
      'tax_bps', s.tax_bps,
      'service_charge_bps', s.service_charge_bps,
      'prices_include_tax', s.prices_include_tax,
      'discount_reduces_charges', s.discount_reduces_charges,
      'service_charge_on_dine_in', s.service_charge_on_dine_in,
      'service_charge_on_take_away', s.service_charge_on_take_away,
      'service_charge_on_delivery', s.service_charge_on_delivery,
      'tax_on_service_charge', s.tax_on_service_charge,
      'rounding_mode', s.rounding_mode,
      'rounding_unit_minor', s.rounding_unit_minor
    );
  end if;

  return v_result;
end;
$$;

-- Admin only: cost prices (hidden from every direct SELECT).
create function public.admin_menu_item_costs()
returns table (menu_item_id uuid, cost_price bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query select m.id, m.cost_price from public.menu_items m order by m.id;
end;
$$;

-- Admin only: cost snapshots of one order's lines (profit reports come in P4).
create function public.admin_order_item_costs(p_order_id uuid)
returns table (order_item_id uuid, cost_snapshot bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select i.id, i.cost_snapshot from public.order_items i where i.order_id = p_order_id order by i.id;
end;
$$;

-- Admin only: staff list including phone numbers (hidden from every direct SELECT).
create function public.admin_staff_directory()
returns table (
  id uuid,
  username text,
  full_name text,
  phone text,
  role public.app_role,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select p.id, p.username, p.full_name, p.phone, p.role, p.is_active
      from public.profiles p
     order by p.is_active desc, p.full_name;
end;
$$;

revoke all on function private.require_role(public.app_role[]) from public, anon, authenticated;
grant execute on function public.get_settings() to authenticated;
grant execute on function public.admin_menu_item_costs() to authenticated;
grant execute on function public.admin_order_item_costs(uuid) to authenticated;
grant execute on function public.admin_staff_directory() to authenticated;

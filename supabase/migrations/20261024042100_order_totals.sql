-- Order totals (BR-01, BR-16): the ONLY place money is calculated. Every rule comes from the
-- settings row, so the owner's answer to Q1 changes data, not code. Formula and defaults:
-- docs/pricing-rules.md (assumed, to be confirmed).
--
-- All arithmetic is exact `numeric` on integer minor units; each calculated charge is rounded
-- once per order (not per line) to settings.rounding_unit_minor using settings.rounding_mode.

create function private.round_to_unit(
  p_value numeric,
  p_unit integer,
  p_mode public.rounding_mode
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_units numeric;
  v_floor numeric;
  v_result numeric;
begin
  if p_value is null or p_value < 0 then
    raise exception 'ROUNDING_NEEDS_NON_NEGATIVE_VALUE' using errcode = 'P0001';
  end if;
  if p_unit is null or p_unit < 1 then
    raise exception 'ROUNDING_UNIT_INVALID' using errcode = 'P0001';
  end if;

  v_units := p_value / p_unit;
  v_floor := floor(v_units);

  v_result := case p_mode
    when 'half_up' then floor(v_units + 0.5)
    when 'half_even' then
      case
        when v_units - v_floor > 0.5 then v_floor + 1
        when v_units - v_floor < 0.5 then v_floor
        when mod(v_floor, 2) = 0 then v_floor
        else v_floor + 1
      end
    when 'up' then ceil(v_units)
    when 'down' then v_floor
  end;

  return (v_result * p_unit)::bigint;
end;
$$;

-- Pure calculation from a subtotal and discount, using the branch's settings.
create function private.compute_order_totals(
  p_subtotal bigint,
  p_discount bigint,
  p_type public.order_type,
  p_branch_id uuid default private.default_branch_id()
)
returns table (
  subtotal bigint,
  discount bigint,
  service_charge bigint,
  tax bigint,
  total bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.settings%rowtype;
  v_net bigint;
  v_base bigint;
  v_service_charge bigint := 0;
  v_tax bigint;
  v_service_charge_tax bigint := 0;
  v_applies boolean;
begin
  if p_subtotal is null or p_subtotal < 0 then
    raise exception 'SUBTOTAL_INVALID' using errcode = 'P0001';
  end if;
  if p_discount is null or p_discount < 0 or p_discount > p_subtotal then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  select * into s from public.settings where branch_id = p_branch_id;
  if not found then
    raise exception 'SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  v_net := p_subtotal - p_discount;
  v_base := case when s.discount_reduces_charges then v_net else p_subtotal end;

  v_applies := case p_type
    when 'dine_in' then s.service_charge_on_dine_in
    when 'take_away' then s.service_charge_on_take_away
    when 'delivery' then s.service_charge_on_delivery
  end;

  if v_applies then
    v_service_charge := private.round_to_unit(
      v_base::numeric * s.service_charge_bps / 10000, s.rounding_unit_minor, s.rounding_mode);
  end if;

  if s.prices_include_tax then
    -- Tax is already inside the prices: report the included part, do not add it.
    v_tax := private.round_to_unit(
      v_base::numeric * s.tax_bps / (10000 + s.tax_bps), s.rounding_unit_minor, s.rounding_mode);
    if s.tax_on_service_charge then
      -- The service charge itself is not tax-inclusive, so its tax is added on top.
      v_service_charge_tax := private.round_to_unit(
        v_service_charge::numeric * s.tax_bps / 10000, s.rounding_unit_minor, s.rounding_mode);
    end if;
    return query select p_subtotal, p_discount, v_service_charge,
      v_tax + v_service_charge_tax, v_net + v_service_charge + v_service_charge_tax;
  else
    v_tax := private.round_to_unit(
      (v_base + case when s.tax_on_service_charge then v_service_charge else 0 end)::numeric
        * s.tax_bps / 10000,
      s.rounding_unit_minor, s.rounding_mode);
    return query select p_subtotal, p_discount, v_service_charge, v_tax,
      v_net + v_service_charge + v_tax;
  end if;
end;
$$;

-- Recalculates an order from its non-cancelled lines and stored discount, saves the result
-- on the order and returns it. Called by every function that changes lines or the discount.
create function private.calc_order_totals(p_order_id uuid)
returns table (
  subtotal bigint,
  discount bigint,
  service_charge bigint,
  tax bigint,
  total bigint
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_subtotal bigint;
  t record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(i.line_total), 0)::bigint into v_subtotal
    from public.order_items i
   where i.order_id = p_order_id and not i.is_cancelled;

  select * into t
    from private.compute_order_totals(
      v_subtotal, least(v_order.discount, v_subtotal), v_order.type, v_order.branch_id);

  update public.orders o
     set subtotal = t.subtotal,
         discount = t.discount,
         service_charge = t.service_charge,
         tax = t.tax,
         total = t.total
   where o.id = p_order_id;

  return query select t.subtotal, t.discount, t.service_charge, t.tax, t.total;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

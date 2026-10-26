-- Settings for the Admin (M2, S5): edit every business value, and a read-only Bill check.
--
--   * settings.tax_registration_number: optional, printed on the receipt when set.
--   * get_settings: the contact group also returns tax_registration_number.
--   * update_settings: Admin only, a partial update (only the keys sent), every value checked.
--     The currency (code and minor units) can change only while there are no orders: stored
--     amounts are minor units of the current currency, so changing it later would change the
--     meaning of every old bill.
--   * preview_bill_totals ("Bill check"): the server's totals for typed line amounts with the
--     CURRENT settings, through private.compute_order_totals (the same formula as every order,
--     BR-01, BR-16). Writes nothing.
--   * Every settings change is written to the audit log (settings.changed, BR-24) by a trigger,
--     with only the changed values.

alter table public.settings
  add column tax_registration_number text check (length(tax_registration_number) <= 40);

comment on column public.settings.tax_registration_number is
  'Optional tax registration number (e.g. NTN/STRN), printed on the receipt when set.';

-- Same as before (role_scoped_rpcs), plus tax_registration_number in the contact group.
create or replace function public.get_settings()
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
      'receipt_footer', s.receipt_footer,
      'tax_registration_number', s.tax_registration_number
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

-- A required boolean at p_key.
create function private.json_bool(p_value jsonb, p_key text, p_error text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(jsonb_typeof(p_value -> p_key), 'missing') <> 'boolean' then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  return (p_value ->> p_key)::boolean;
end;
$$;

-- update_settings: changes the keys in p_changes (any of the settings columns below) and
-- returns get_settings() plus "replayed". Pattern: docs/adr/001.
-- Errors (P0001 unless noted): NOT_AUTHORIZED, MFA_REQUIRED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, SETTINGS_INVALID, SETTING_NOT_ALLOWED, RESTAURANT_NAME_INVALID,
--   CONTACT_INVALID, CURRENCY_INVALID, CURRENCY_LOCKED, TIMEZONE_INVALID, CUTOFF_INVALID,
--   RATE_INVALID, PRICING_RULE_INVALID, ROUNDING_INVALID, KITCHEN_MINUTES_INVALID.
create function public.update_settings(p_request_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  s public.settings%rowtype;
  v_old public.settings%rowtype;
  v_cutoff text;
  v_mode text;
  v_unit bigint;
begin
  perform private.require_role('admin');
  v_replay := private.replay('update_settings', p_request_id, null, p_changes);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.check_json_object(p_changes, array[
    'restaurant_name', 'address', 'phone', 'receipt_footer', 'tax_registration_number',
    'currency_code', 'currency_minor_units', 'timezone', 'day_cutoff_time',
    'tax_bps', 'service_charge_bps',
    'prices_include_tax', 'discount_reduces_charges', 'service_charge_on_dine_in',
    'service_charge_on_take_away', 'service_charge_on_delivery', 'tax_on_service_charge',
    'rounding_mode', 'rounding_unit_minor', 'kitchen_warn_min', 'kitchen_late_min'
  ], 'SETTINGS_INVALID', 'SETTING_NOT_ALLOWED');

  select * into s from public.settings where branch_id = private.default_branch_id() for update;
  if not found then
    raise exception 'SETTINGS_MISSING' using errcode = 'P0001';
  end if;
  v_old := s;

  -- Restaurant details
  if p_changes ? 'restaurant_name' then
    s.restaurant_name := private.json_text(p_changes, 'restaurant_name', 120, 'RESTAURANT_NAME_INVALID');
    if s.restaurant_name is null then
      raise exception 'RESTAURANT_NAME_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if p_changes ? 'address' then
    s.address := private.json_text(p_changes, 'address', 300, 'CONTACT_INVALID');
  end if;
  if p_changes ? 'phone' then
    s.phone := private.json_text(p_changes, 'phone', 30, 'CONTACT_INVALID');
  end if;
  if p_changes ? 'receipt_footer' then
    s.receipt_footer := private.json_text(p_changes, 'receipt_footer', 500, 'CONTACT_INVALID');
  end if;
  if p_changes ? 'tax_registration_number' then
    s.tax_registration_number := private.json_text(p_changes, 'tax_registration_number', 40, 'CONTACT_INVALID');
  end if;

  -- Currency: only while no order exists (see the header).
  if p_changes ? 'currency_code' then
    if coalesce(jsonb_typeof(p_changes -> 'currency_code'), 'missing') <> 'string'
       or (p_changes ->> 'currency_code') !~ '^[A-Z]{3}$' then
      raise exception 'CURRENCY_INVALID' using errcode = 'P0001';
    end if;
    s.currency_code := p_changes ->> 'currency_code';
  end if;
  if p_changes ? 'currency_minor_units' then
    s.currency_minor_units := private.json_int(p_changes, 'currency_minor_units', 0, 3, 'CURRENCY_INVALID');
  end if;
  if (s.currency_code, s.currency_minor_units) is distinct from (v_old.currency_code, v_old.currency_minor_units)
     and exists (select 1 from public.orders) then
    raise exception 'CURRENCY_LOCKED' using errcode = 'P0001';
  end if;

  -- Business day (BR-04, G10)
  if p_changes ? 'timezone' then
    if coalesce(jsonb_typeof(p_changes -> 'timezone'), 'missing') <> 'string'
       or not private.is_valid_timezone(p_changes ->> 'timezone') then
      raise exception 'TIMEZONE_INVALID' using errcode = 'P0001';
    end if;
    s.timezone := p_changes ->> 'timezone';
  end if;
  if p_changes ? 'day_cutoff_time' then
    v_cutoff := p_changes ->> 'day_cutoff_time';
    if coalesce(jsonb_typeof(p_changes -> 'day_cutoff_time'), 'missing') <> 'string'
       or v_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
       or v_cutoff::time >= '12:00' then
      raise exception 'CUTOFF_INVALID' using errcode = 'P0001';
    end if;
    s.day_cutoff_time := v_cutoff::time;
  end if;

  -- Rates in basis points (BR-16)
  if p_changes ? 'tax_bps' then
    s.tax_bps := private.json_int(p_changes, 'tax_bps', 0, 10000, 'RATE_INVALID');
  end if;
  if p_changes ? 'service_charge_bps' then
    s.service_charge_bps := private.json_int(p_changes, 'service_charge_bps', 0, 10000, 'RATE_INVALID');
  end if;

  -- Pricing rules (docs/pricing-rules.md)
  if p_changes ? 'prices_include_tax' then
    s.prices_include_tax := private.json_bool(p_changes, 'prices_include_tax', 'PRICING_RULE_INVALID');
  end if;
  if p_changes ? 'discount_reduces_charges' then
    s.discount_reduces_charges := private.json_bool(p_changes, 'discount_reduces_charges', 'PRICING_RULE_INVALID');
  end if;
  if p_changes ? 'service_charge_on_dine_in' then
    s.service_charge_on_dine_in := private.json_bool(p_changes, 'service_charge_on_dine_in', 'PRICING_RULE_INVALID');
  end if;
  if p_changes ? 'service_charge_on_take_away' then
    s.service_charge_on_take_away := private.json_bool(p_changes, 'service_charge_on_take_away', 'PRICING_RULE_INVALID');
  end if;
  if p_changes ? 'service_charge_on_delivery' then
    s.service_charge_on_delivery := private.json_bool(p_changes, 'service_charge_on_delivery', 'PRICING_RULE_INVALID');
  end if;
  if p_changes ? 'tax_on_service_charge' then
    s.tax_on_service_charge := private.json_bool(p_changes, 'tax_on_service_charge', 'PRICING_RULE_INVALID');
  end if;

  -- Rounding
  if p_changes ? 'rounding_mode' then
    v_mode := p_changes ->> 'rounding_mode';
    if coalesce(jsonb_typeof(p_changes -> 'rounding_mode'), 'missing') <> 'string'
       or not v_mode = any (enum_range(null::public.rounding_mode)::text[]) then
      raise exception 'ROUNDING_INVALID' using errcode = 'P0001';
    end if;
    s.rounding_mode := v_mode::public.rounding_mode;
  end if;
  if p_changes ? 'rounding_unit_minor' then
    v_unit := private.json_int(p_changes, 'rounding_unit_minor', 1, 100000, 'ROUNDING_INVALID');
    s.rounding_unit_minor := v_unit;
  end if;

  -- Kitchen age colours (G11): warn 1 to 240 minutes, late after warn and at most 480.
  if p_changes ? 'kitchen_warn_min' then
    s.kitchen_warn_min := private.json_int(p_changes, 'kitchen_warn_min', 1, 240, 'KITCHEN_MINUTES_INVALID');
  end if;
  if p_changes ? 'kitchen_late_min' then
    s.kitchen_late_min := private.json_int(p_changes, 'kitchen_late_min', 2, 480, 'KITCHEN_MINUTES_INVALID');
  end if;
  if s.kitchen_late_min <= s.kitchen_warn_min then
    raise exception 'KITCHEN_MINUTES_INVALID' using errcode = 'P0001';
  end if;

  update public.settings x
     set restaurant_name = s.restaurant_name,
         address = s.address,
         phone = s.phone,
         receipt_footer = s.receipt_footer,
         tax_registration_number = s.tax_registration_number,
         currency_code = s.currency_code,
         currency_minor_units = s.currency_minor_units,
         timezone = s.timezone,
         day_cutoff_time = s.day_cutoff_time,
         tax_bps = s.tax_bps,
         service_charge_bps = s.service_charge_bps,
         prices_include_tax = s.prices_include_tax,
         discount_reduces_charges = s.discount_reduces_charges,
         service_charge_on_dine_in = s.service_charge_on_dine_in,
         service_charge_on_take_away = s.service_charge_on_take_away,
         service_charge_on_delivery = s.service_charge_on_delivery,
         tax_on_service_charge = s.tax_on_service_charge,
         rounding_mode = s.rounding_mode,
         rounding_unit_minor = s.rounding_unit_minor,
         kitchen_warn_min = s.kitchen_warn_min,
         kitchen_late_min = s.kitchen_late_min
   where x.branch_id = s.branch_id;

  return private.remember('update_settings', p_request_id, null, public.get_settings(), p_changes);
end;
$$;

comment on function public.update_settings(uuid, jsonb) is
  'Admin: partial settings update with range checks; audited (settings.changed). See ADR 001.';

-- preview_bill_totals ("Bill check"): totals for typed line amounts (minor units, each line
-- already quantity x price) and a discount, for an order type, with the current settings.
-- Returns {type, line_count, subtotal, discount, service_charge, tax, total}. Writes nothing.
-- Errors: NOT_AUTHORIZED, MFA_REQUIRED (42501), ORDER_TYPE_REQUIRED, LINES_REQUIRED,
--   LINES_TOO_MANY, LINE_AMOUNT_INVALID, DISCOUNT_INVALID, DISCOUNT_TOO_LARGE, SETTINGS_MISSING.
create function public.preview_bill_totals(
  p_type public.order_type,
  p_line_amounts bigint[],
  p_discount bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subtotal bigint;
  t record;
begin
  perform private.require_role('admin');
  if p_type is null then
    raise exception 'ORDER_TYPE_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_line_amounts), 0) = 0 then
    raise exception 'LINES_REQUIRED' using errcode = 'P0001';
  end if;
  if cardinality(p_line_amounts) > 100 then
    raise exception 'LINES_TOO_MANY' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_line_amounts) a where a is null or a <= 0 or a > 1000000000000) then
    raise exception 'LINE_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if p_discount is null or p_discount < 0 then
    raise exception 'DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  select sum(a)::bigint into v_subtotal from unnest(p_line_amounts) a;
  if p_discount > v_subtotal then
    raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;

  select * into t from private.compute_order_totals(v_subtotal, p_discount, p_type);
  return jsonb_build_object(
    'type', p_type,
    'line_count', cardinality(p_line_amounts),
    'subtotal', t.subtotal,
    'discount', t.discount,
    'service_charge', t.service_charge,
    'tax', t.tax,
    'total', t.total
  );
end;
$$;

comment on function public.preview_bill_totals(public.order_type, bigint[], bigint) is
  'Admin Bill check: totals for typed line amounts with the current settings. Read-only.';

-- settings.changed (BR-24): only the values that changed.
create function private.audit_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d record;
begin
  select * into d from private.row_diff(to_jsonb(old), to_jsonb(new), array['updated_at']);
  if d.old_value is not null then
    perform private.audit('settings.changed', 'settings', new.branch_id, null, d.old_value, d.new_value);
  end if;
  return null;
end;
$$;

create trigger settings_audit
  after update on public.settings
  for each row execute function private.audit_settings();

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.update_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_settings(uuid, jsonb) to authenticated;
revoke all on function public.preview_bill_totals(public.order_type, bigint[], bigint) from public, anon;
grant execute on function public.preview_bill_totals(public.order_type, bigint[], bigint) to authenticated;

-- Shared input checks for the business functions (ADR 002, condition 2). Every P1 function
-- validates its JSON and text input with these instead of copying the checks from
-- create_order. Each helper takes the stable error code to raise, so callers keep their own
-- codes (ITEM_INVALID, TENDER_AMOUNT_INVALID, ...). All raise with errcode P0001.
-- Pitfalls handled here once: a missing key is NULL, and NULL in a condition is "not false"
-- (ADR 001, pitfall 1).

-- p_value must be a JSON object whose keys are all in p_allowed.
--   not an object -> p_invalid; unknown key -> p_field_not_allowed (detail names the key)
create function private.check_json_object(
  p_value jsonb,
  p_allowed text[],
  p_invalid text,
  p_field_not_allowed text
)
returns void
language plpgsql
stable  -- format() in the error detail is stable, not immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '%', p_invalid using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not v_key = any (p_allowed) then
      raise exception '%', p_field_not_allowed using errcode = 'P0001',
        detail = format('field "%s" is not accepted', v_key);
    end if;
  end loop;
end;
$$;

-- Required uuid string at p_key.
create function private.json_uuid(p_value jsonb, p_key text, p_error text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(jsonb_typeof(p_value -> p_key), 'missing') <> 'string'
     or (p_value ->> p_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  return (p_value ->> p_key)::uuid;
end;
$$;

-- Required whole number at p_key, between p_min and p_max (both >= 0). A JSON number with a
-- fraction (1.5, 1.0), a string or a boolean is rejected.
create function private.json_int(
  p_value jsonb,
  p_key text,
  p_min bigint,
  p_max bigint,
  p_error text
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number bigint;
begin
  if coalesce(jsonb_typeof(p_value -> p_key), 'missing') <> 'number'
     or (p_value ->> p_key) !~ '^[0-9]{1,15}$' then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  v_number := (p_value ->> p_key)::bigint;
  if v_number < p_min or v_number > p_max then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  return v_number;
end;
$$;

-- Optional text at p_key: a string or null (or missing). Trimmed; empty becomes NULL. Longer
-- than p_max characters, or any other JSON type, raises p_error.
create function private.json_text(p_value jsonb, p_key text, p_max integer, p_error text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if coalesce(jsonb_typeof(p_value -> p_key), 'null') not in ('string', 'null') then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  v_text := nullif(btrim(p_value ->> p_key), '');
  if coalesce(length(v_text), 0) > p_max then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- Optional text parameter: trimmed, empty becomes NULL, longer than p_max raises p_error.
create function private.clean_text(p_text text, p_max integer, p_error text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(p_text), '');
begin
  if coalesce(length(v_text), 0) > p_max then
    raise exception '%', p_error using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- A mandatory reason (cancel, discount, void: BR-09, BR-10, BR-24). Trimmed, 1 to 300
-- characters (the size of every *_reason column). Errors: REASON_REQUIRED, REASON_TOO_LONG.
create function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 300 then
    raise exception 'REASON_TOO_LONG' using errcode = 'P0001';
  end if;
  return v_reason;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Business day and order numbering helpers (BR-03, BR-04, D10, G10, G16). Internal only:
-- called by the order functions (T6+), never by clients.

-- BR-04: the business day ends at settings.day_cutoff_time in settings.timezone. A moment
-- before the cut-off (for example 02:00 with a 04:00 cut-off) belongs to the previous day.
create function private.business_date(
  p_at timestamptz default now(),
  p_branch_id uuid default private.default_branch_id()
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_timezone text;
  v_cutoff time;
begin
  if p_at is null then
    raise exception 'BUSINESS_DATE_NEEDS_TIME' using errcode = 'P0001';
  end if;

  select timezone, day_cutoff_time
    into v_timezone, v_cutoff
    from public.settings
   where branch_id = p_branch_id;

  if not found then
    raise exception 'SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  return ((p_at at time zone v_timezone) - (v_cutoff - time '00:00'))::date;
end;
$$;

-- BR-03: ORD-YYYYMMDD-NNN, unique per branch and business day, restarting each day. The
-- upsert takes a row lock, so concurrent callers are serialised and never share a number.
-- After 999 orders the number simply grows (ORD-20261024-1000) instead of failing (G16).
create function private.next_order_number(
  p_business_date date,
  p_branch_id uuid default private.default_branch_id()
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_number integer;
begin
  if p_business_date is null then
    raise exception 'ORDER_NUMBER_NEEDS_DATE' using errcode = 'P0001';
  end if;

  insert into public.order_counters (branch_id, business_date, last_number)
  values (p_branch_id, p_business_date, 1)
  on conflict (branch_id, business_date)
  do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_number;

  return 'ORD-' || to_char(p_business_date, 'YYYYMMDD') || '-'
    || case when v_number < 1000 then lpad(v_number::text, 3, '0') else v_number::text end;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

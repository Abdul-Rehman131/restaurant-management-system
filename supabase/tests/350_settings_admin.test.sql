-- update_settings and preview_bill_totals (S5, M2): partial updates with range checks, the
-- currency lock, the audit entry (settings.changed, BR-24), idempotency, roles; the Bill check
-- uses the current settings and the same formula as orders (BR-01, BR-16) and writes nothing.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(49);

select tests.create_staff('st.admin', 'admin') as admin \gset
select tests.create_staff('st.cashier', 'cashier') as cashier \gset
select tests.create_staff('st.waiter', 'waiter') as waiter \gset
select tests.create_staff('st.chef', 'chef') as chef \gset
select tests.create_staff('st.rider', 'rider') as rider \gset
select tests.create_staff('st.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';

-- A known starting point (the seed has its own demo values).
update public.settings
   set restaurant_name = 'My Restaurant', address = null, phone = null, receipt_footer = null,
       tax_registration_number = null, timezone = 'Asia/Karachi', day_cutoff_time = '04:00',
       tax_bps = 0, service_charge_bps = 0, prices_include_tax = false,
       discount_reduces_charges = true, service_charge_on_dine_in = true,
       service_charge_on_take_away = false, service_charge_on_delivery = false,
       tax_on_service_charge = false, rounding_mode = 'half_up', rounding_unit_minor = 1,
       kitchen_warn_min = 10, kitchen_late_min = 20;

create function tests.upd(p_changes jsonb, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.update_settings(%L, %L) $f$, p_request, p_changes)
$$;
create function tests.err(p_changes jsonb) returns text language sql as $$
  select tests.outcome_as((select id from public.profiles where username = 'st.admin'), tests.upd(p_changes))
$$;

-- ===== Happy path =====
select gen_random_uuid() as req1 \gset
select tests.call_as(:'admin', tests.upd(
  '{"restaurant_name": "  ST Grill  ", "tax_registration_number": "NTN 1234567-8", "tax_bps": 1600,
    "service_charge_bps": 500, "kitchen_warn_min": 8, "kitchen_late_min": 15,
    "day_cutoff_time": "05:30", "timezone": "Asia/Dubai", "rounding_mode": "half_even",
    "service_charge_on_take_away": true}', :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'restaurant_name', 'ST Grill', 'the name is saved, trimmed');
select is(:'r1'::jsonb ->> 'tax_registration_number', 'NTN 1234567-8', 'the tax registration number is saved');
select is((:'r1'::jsonb ->> 'tax_bps')::int, 1600, 'the tax rate is saved (basis points)');
select is(:'r1'::jsonb ->> 'day_cutoff_time', '05:30:00', 'the cut-off is saved');
select is(:'r1'::jsonb ->> 'timezone', 'Asia/Dubai', 'the time zone is saved');
select is(:'r1'::jsonb ->> 'replayed', 'false', 'a first call is not a replay');
select is((select receipt_footer from public.settings), null, 'keys that were not sent are unchanged');

-- Audit: one settings.changed row with only the changed values.
select is(
  (select count(*)::int from public.audit_log where action = 'settings.changed' and user_id = :'admin'),
  1, 'the change is in the audit log once (BR-24)');
select is(
  (select array_agg(k order by k) from public.audit_log a, jsonb_object_keys(a.new_value) k
    where a.action = 'settings.changed' and a.user_id = :'admin'),
  array['day_cutoff_time', 'kitchen_late_min', 'kitchen_warn_min', 'restaurant_name', 'rounding_mode',
        'service_charge_bps', 'service_charge_on_take_away', 'tax_bps', 'tax_registration_number', 'timezone'],
  'the audit entry lists only the changed values');
select is(
  (select old_value ->> 'restaurant_name' from public.audit_log
    where action = 'settings.changed' and user_id = :'admin'),
  'My Restaurant', 'with the old value');

-- Idempotency (BR-15)
select is(tests.call_as(:'admin', tests.upd(
  '{"restaurant_name": "  ST Grill  ", "tax_registration_number": "NTN 1234567-8", "tax_bps": 1600,
    "service_charge_bps": 500, "kitchen_warn_min": 8, "kitchen_late_min": 15,
    "day_cutoff_time": "05:30", "timezone": "Asia/Dubai", "rounding_mode": "half_even",
    "service_charge_on_take_away": true}', :'req1')) ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.outcome_as(:'admin', tests.upd('{"tax_bps": 0}', :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with other changes is a conflict');
select is((select count(*)::int from public.audit_log where action = 'settings.changed' and user_id = :'admin'),
  1, 'the replay wrote nothing');

-- Clearing an optional field, and an unchanged save writes no audit row.
select is(tests.call_as(:'admin', tests.upd('{"tax_registration_number": ""}')) ->> 'tax_registration_number',
  null, 'an empty tax registration number clears it');
select tests.call_as(:'admin', tests.upd('{"tax_bps": 1600}')) as same \gset
select is((select count(*)::int from public.audit_log where action = 'settings.changed' and user_id = :'admin'),
  2, 'saving the same value again is not logged');

-- ===== Validation =====
select is(tests.err('[1]'), 'SETTINGS_INVALID', 'not an object');
select is(tests.err('{"price": 1}'), 'SETTING_NOT_ALLOWED', 'an unknown key');
select is(tests.err('{"restaurant_name": " "}'), 'RESTAURANT_NAME_INVALID', 'an empty name');
select is(tests.err(jsonb_build_object('restaurant_name', repeat('x', 121))), 'RESTAURANT_NAME_INVALID', 'a name over 120');
select is(tests.err(jsonb_build_object('receipt_footer', repeat('x', 501))), 'CONTACT_INVALID', 'a footer over 500');
select is(tests.err(jsonb_build_object('tax_registration_number', repeat('x', 41))), 'CONTACT_INVALID', 'a tax number over 40');
select is(tests.err('{"phone": 5}'), 'CONTACT_INVALID', 'a phone that is not text');
select is(tests.err('{"timezone": "Mars/Olympus"}'), 'TIMEZONE_INVALID', 'an unknown time zone');
select is(tests.err('{"day_cutoff_time": "12:00"}'), 'CUTOFF_INVALID', 'a cut-off at noon or later');
select is(tests.err('{"day_cutoff_time": "4am"}'), 'CUTOFF_INVALID', 'a cut-off that is not HH:MM');
select is(tests.err('{"tax_bps": 10001}'), 'RATE_INVALID', 'a rate over 100%');
select is(tests.err('{"service_charge_bps": -1}'), 'RATE_INVALID', 'a negative rate');
select is(tests.err('{"tax_bps": 16.5}'), 'RATE_INVALID', 'a rate that is not whole basis points');
select is(tests.err('{"prices_include_tax": "yes"}'), 'PRICING_RULE_INVALID', 'a rule that is not true or false');
select is(tests.err('{"rounding_mode": "nearest"}'), 'ROUNDING_INVALID', 'an unknown rounding mode');
select is(tests.err('{"rounding_unit_minor": 0}'), 'ROUNDING_INVALID', 'a rounding unit of 0');
select is(tests.err('{"kitchen_warn_min": 20, "kitchen_late_min": 20}'), 'KITCHEN_MINUTES_INVALID', 'late must be after warn');
select is(tests.err('{"kitchen_warn_min": 0}'), 'KITCHEN_MINUTES_INVALID', 'warn of 0 minutes');
select is(tests.err('{"currency_code": "pkr"}'), 'CURRENCY_INVALID', 'a currency that is not 3 capitals');

-- The currency is locked once an order exists.
select tests.create_order('take_away', null, 1) as o1 \gset
select is(tests.err('{"currency_code": "AED"}'), 'CURRENCY_LOCKED', 'once an order exists the currency cannot change');
select is(tests.err('{"currency_code": "PKR", "tax_bps": 1600}'), 'ok', 'sending the current currency again is fine');

-- ===== Roles =====
select is(tests.outcome_as(:'cashier', tests.upd('{"tax_bps": 0}')), 'NOT_AUTHORIZED', 'cashier may not');
select is(tests.outcome_as(:'waiter', tests.upd('{"tax_bps": 0}')), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'chef', tests.upd('{"tax_bps": 0}')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.upd('{"tax_bps": 0}')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.upd('{"tax_bps": 0}')), 'NOT_AUTHORIZED', 'a deactivated admin may not');
select is(tests.outcome_as(null, tests.upd('{"tax_bps": 0}')), 'PERMISSION_DENIED', 'anon may not');

-- ===== Bill check =====
-- Settings now: tax 16%, service 5% (dine-in and take away), discount reduces charges, tax not
-- on service charge, prices exclusive of tax, half_even to 1 minor unit.
-- Lines 1,200.00 + 450.00 = 1,650.00; discount 50.00 -> base 1,600.00;
-- service 5% = 80.00; tax 16% of 1,600.00 = 256.00; total 1,600.00 + 80.00 + 256.00 = 1,936.00.
select tests.call_as(:'admin', $$ select public.preview_bill_totals('dine_in', array[120000, 45000]::bigint[], 5000) $$) as bill \gset
select is(:'bill'::jsonb, '{"type": "dine_in", "line_count": 2, "subtotal": 165000, "discount": 5000,
  "service_charge": 8000, "tax": 25600, "total": 193600}'::jsonb, 'the Bill check matches the hand calculation');
select is(
  (select row(t.subtotal, t.discount, t.service_charge, t.tax, t.total)::text
     from private.compute_order_totals(165000, 5000, 'dine_in') t),
  row(165000, 5000, 8000, 25600, 193600)::text, 'and the formula every order uses');
select is((select count(*)::int from public.audit_log where action <> 'settings.changed' and user_id = :'admin'),
  0, 'the Bill check wrote nothing');

select is(tests.outcome_as(:'admin', $$ select public.preview_bill_totals('dine_in', '{}'::bigint[], 0) $$),
  'LINES_REQUIRED', 'at least one line');
select is(tests.outcome_as(:'admin', $$ select public.preview_bill_totals('dine_in', array[100, 0]::bigint[], 0) $$),
  'LINE_AMOUNT_INVALID', 'every line is more than zero');
select is(tests.outcome_as(:'admin', $$ select public.preview_bill_totals('dine_in', array[100]::bigint[], 101) $$),
  'DISCOUNT_TOO_LARGE', 'the discount is at most the subtotal');
select is(tests.outcome_as(:'cashier', $$ select public.preview_bill_totals('dine_in', array[100]::bigint[], 0) $$),
  'NOT_AUTHORIZED', 'the Bill check is Admin only');

select * from finish();
rollback;

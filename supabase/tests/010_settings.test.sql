-- Settings: default row, G7 default pricing rules, and constraints.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select is(
  (select count(*)::int from public.settings),
  1,
  'exactly one settings row exists after migrations'
);

select results_eq(
  $$ select prices_include_tax, discount_reduces_charges, service_charge_on_dine_in,
            service_charge_on_take_away, service_charge_on_delivery, tax_on_service_charge,
            rounding_mode::text, rounding_unit_minor
       from public.settings $$,
  $$ values (false, true, true, false, false, false, 'half_up', 1) $$,
  'pricing rules default to the G7 assumptions (to be confirmed, Q1)'
);

select results_eq(
  $$ select timezone, day_cutoff_time, currency_code, currency_minor_units from public.settings $$,
  $$ values ('Asia/Karachi'::text, '04:00'::time, 'PKR'::text, 2::smallint) $$,
  'business-day and currency defaults'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.settings'::regclass),
  'RLS is enabled on settings'
);

-- Constraints
select throws_ok($$ update public.settings set tax_bps = 10001 $$, '23514', null, 'tax_bps above 100% is rejected');
select throws_ok($$ update public.settings set tax_bps = -1 $$, '23514', null, 'negative tax_bps is rejected');
select throws_ok($$ update public.settings set service_charge_bps = 10001 $$, '23514', null, 'service_charge_bps above 100% is rejected');
select throws_ok($$ update public.settings set timezone = 'Mars/Olympus' $$, '23514', null, 'an unknown time zone is rejected');
select throws_ok($$ update public.settings set day_cutoff_time = '12:00' $$, '23514', null, 'a cut-off at or after noon is rejected');
select throws_ok($$ update public.settings set kitchen_late_min = 10, kitchen_warn_min = 10 $$, '23514', null, 'kitchen late threshold must be above warn threshold');
select throws_ok($$ update public.settings set currency_code = 'pkr' $$, '23514', null, 'currency code must be 3 upper-case letters');
select throws_ok($$ update public.settings set rounding_unit_minor = 0 $$, '23514', null, 'rounding unit must be at least 1');
select throws_ok($$ update public.settings set restaurant_name = '   ' $$, '23514', null, 'a blank restaurant name is rejected');

select lives_ok(
  $$ update public.settings set tax_bps = 1600, service_charge_bps = 500, timezone = 'UTC',
       prices_include_tax = true, rounding_mode = 'half_even', rounding_unit_minor = 100 $$,
  'valid rate, time zone and rule changes are accepted (data, not schema)'
);

select * from finish();
rollback;

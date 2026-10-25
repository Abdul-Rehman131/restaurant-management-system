-- business_date (BR-04) around midnight and the 04:00 cut-off, and next_order_number (BR-03).
-- Settings defaults: timezone Asia/Karachi (UTC+5, no DST), cut-off 04:00.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(16);

-- Exact order numbers below: ignore any orders already in the database.
select tests.clear_order_numbers();

-- BR-04 edge cases, local Karachi time on the night of 24 -> 25 October 2026
select is(private.business_date('2026-10-24 23:59:00+05'), date '2026-10-24', '23:59 belongs to the same day');
select is(private.business_date('2026-10-25 00:01:00+05'), date '2026-10-24', '00:01 belongs to the previous day');
select is(private.business_date('2026-10-25 03:59:00+05'), date '2026-10-24', '03:59 belongs to the previous day');
select is(private.business_date('2026-10-25 03:59:59.999+05'), date '2026-10-24', '03:59:59.999 is still the previous day');
select is(private.business_date('2026-10-25 04:00:00+05'), date '2026-10-25', '04:00 starts the new business day');

-- The settings time zone is used, not the server's UTC clock
select is(
  private.business_date('2026-10-24 23:30:00+00'),
  date '2026-10-25',
  '23:30 UTC is 04:30 in Karachi, so it is already the next business day'
);

-- Cut-off and time zone are data
update public.settings set day_cutoff_time = '00:00';
select is(private.business_date('2026-10-25 00:01:00+05'), date '2026-10-25', 'with a midnight cut-off, 00:01 is the new day');
update public.settings set day_cutoff_time = '04:00', timezone = 'UTC';
select is(private.business_date('2026-10-25 03:59:00+00'), date '2026-10-24', 'with timezone UTC, 03:59 UTC is the previous day');
update public.settings set timezone = 'Asia/Karachi';

select throws_ok(
  $$ select private.business_date(now(), gen_random_uuid()) $$,
  'P0001', 'SETTINGS_MISSING', 'an unknown branch has no business day'
);

-- BR-03 numbering
select is(private.next_order_number('2026-10-24'), 'ORD-20261024-001', 'the first order of a day is 001');
select is(private.next_order_number('2026-10-24'), 'ORD-20261024-002', 'the next order is 002');
select is(private.next_order_number('2026-10-25'), 'ORD-20261025-001', 'the sequence restarts on a new business day');
select is(private.next_order_number('2026-10-24'), 'ORD-20261024-003', 'the earlier day continues independently');

update public.order_counters set last_number = 998 where business_date = '2026-10-24';
select is(private.next_order_number('2026-10-24'), 'ORD-20261024-999', 'number 999 keeps three digits');
select is(private.next_order_number('2026-10-24'), 'ORD-20261024-1000', 'after 999 the number grows to four digits (G16)');
select ok(
  private.next_order_number('2026-10-24') ~ '^ORD-[0-9]{8}-[0-9]{3,}$',
  'generated numbers satisfy the orders.order_number format check'
);

select * from finish();
rollback;

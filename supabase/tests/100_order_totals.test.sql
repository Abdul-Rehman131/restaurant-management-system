-- Order totals: G7 default rules, each Q1 rule as a setting, rounding modes and units, and
-- recalculation from order lines. Every expected value is worked out by hand in the comment.
-- Demo rates for these tests: tax 16% (1600 bps), service charge 5% (500 bps).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(19);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

-- Defaults (G7): exclusive tax, discount reduces charges, service charge on Dine-In only,
-- no tax on service charge, half-up to 1 paisa.
-- Rs 3,500 Dine-In: SC 5% = 175, tax 16% = 560, total 4,235.
select results_eq(
  $$ select * from private.compute_order_totals(350000, 0, 'dine_in') $$,
  $$ values (350000::bigint, 0::bigint, 17500::bigint, 56000::bigint, 423500::bigint) $$,
  'defaults: Dine-In Rs 3,500 -> SC 175, tax 560, total 4,235'
);
-- Take Away: no SC. Tax 560, total 4,060.
select results_eq(
  $$ select * from private.compute_order_totals(350000, 0, 'take_away') $$,
  $$ values (350000::bigint, 0::bigint, 0::bigint, 56000::bigint, 406000::bigint) $$,
  'defaults: Take Away has no service charge'
);
-- Discount 500 reduces charges: base 3,000 -> SC 150, tax 480, total 3,630.
select results_eq(
  $$ select * from private.compute_order_totals(350000, 50000, 'dine_in') $$,
  $$ values (350000::bigint, 50000::bigint, 15000::bigint, 48000::bigint, 363000::bigint) $$,
  'defaults: a discount reduces the service charge and tax base'
);
select throws_ok(
  $$ select * from private.compute_order_totals(1000, 1001, 'dine_in') $$,
  'P0001', 'DISCOUNT_INVALID', 'a discount above the subtotal is rejected'
);

-- Each rule is data
update public.settings set discount_reduces_charges = false;
-- Base stays 3,500: SC 175, tax 560, total 3,000 + 175 + 560 = 3,735.
select results_eq(
  $$ select service_charge, tax, total from private.compute_order_totals(350000, 50000, 'dine_in') $$,
  $$ values (17500::bigint, 56000::bigint, 373500::bigint) $$,
  'discount_reduces_charges = false: charges use the full subtotal'
);
update public.settings set discount_reduces_charges = true, tax_on_service_charge = true;
-- Tax on (3,500 + 175) = 588, total 3,500 + 175 + 588 = 4,263.
select results_eq(
  $$ select service_charge, tax, total from private.compute_order_totals(350000, 0, 'dine_in') $$,
  $$ values (17500::bigint, 58800::bigint, 426300::bigint) $$,
  'tax_on_service_charge = true: tax includes the service charge'
);
update public.settings set tax_on_service_charge = false, service_charge_on_take_away = true;
select is(
  (select service_charge from private.compute_order_totals(350000, 0, 'take_away')),
  17500::bigint,
  'service_charge_on_take_away = true: Take Away pays service charge'
);
update public.settings set service_charge_on_take_away = false, service_charge_on_dine_in = false;
select is(
  (select service_charge from private.compute_order_totals(350000, 0, 'dine_in')),
  0::bigint,
  'service_charge_on_dine_in = false: no service charge on Dine-In'
);
update public.settings set service_charge_on_dine_in = true;

-- Tax-inclusive prices: Rs 1,160 includes 16% tax = 160; total stays 1,160 (+ SC 58).
update public.settings set prices_include_tax = true;
select results_eq(
  $$ select tax, total from private.compute_order_totals(116000, 0, 'take_away') $$,
  $$ values (16000::bigint, 116000::bigint) $$,
  'prices_include_tax = true: tax is extracted, not added'
);
select results_eq(
  $$ select service_charge, tax, total from private.compute_order_totals(116000, 0, 'dine_in') $$,
  $$ values (5800::bigint, 16000::bigint, 121800::bigint) $$,
  'prices_include_tax = true: service charge is still added on top'
);
update public.settings set prices_include_tax = false;

-- Rounding: 10% tax, no SC, on 0.5 and 1.5 paisa edges
update public.settings set tax_bps = 1000, service_charge_bps = 0;
select is((select tax from private.compute_order_totals(5, 0, 'take_away')), 1::bigint, 'half_up: 0.5 -> 1');
select is((select tax from private.compute_order_totals(15, 0, 'take_away')), 2::bigint, 'half_up: 1.5 -> 2');
update public.settings set rounding_mode = 'half_even';
select is((select tax from private.compute_order_totals(5, 0, 'take_away')), 0::bigint, 'half_even: 0.5 -> 0');
select is((select tax from private.compute_order_totals(15, 0, 'take_away')), 2::bigint, 'half_even: 1.5 -> 2');
update public.settings set rounding_mode = 'down';
select is((select tax from private.compute_order_totals(19, 0, 'take_away')), 1::bigint, 'down: 1.9 -> 1');
update public.settings set rounding_mode = 'up';
select is((select tax from private.compute_order_totals(11, 0, 'take_away')), 2::bigint, 'up: 1.1 -> 2');

-- Rounding unit: whole rupees (100 paisa). 16% of Rs 1,234.56 = 197.5296 -> Rs 198.
update public.settings set tax_bps = 1600, rounding_mode = 'half_up', rounding_unit_minor = 100;
select is(
  (select tax from private.compute_order_totals(123456, 0, 'take_away')),
  19800::bigint,
  'rounding_unit_minor = 100 rounds charges to whole rupees'
);
update public.settings set rounding_unit_minor = 1, service_charge_bps = 500;

-- calc_order_totals: recalculates from non-cancelled lines and saves on the order.
select tests.create_table(701) as t1 \gset
select tests.create_item('Test Tikka', 60000) as tikka \gset
select tests.create_item('Test Naan', 30000) as naan \gset
select tests.create_order('dine_in', :'t1', 1) as o1 \gset

insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot, price_snapshot,
                                needs_kitchen, quantity)
values (:'o1', 1, :'tikka', 'Test Tikka', 60000, true, 2),
       (:'o1', 1, :'naan', 'Test Naan', 30000, true, 1);
insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot, price_snapshot,
                                needs_kitchen, quantity, is_cancelled, cancel_reason, cancelled_at)
values (:'o1', 1, :'naan', 'Test Naan', 30000, true, 3, true, 'Customer changed mind', now());

-- Lines: 2 x 600 + 1 x 300 = 1,500 (the cancelled 3 x 300 is ignored).
-- SC 5% = 75, tax 16% = 240, total 1,815.
select results_eq(
  format($$ select * from private.calc_order_totals(%L) $$, :'o1'),
  $$ values (150000::bigint, 0::bigint, 7500::bigint, 24000::bigint, 181500::bigint) $$,
  'calc_order_totals ignores cancelled lines'
);
select results_eq(
  format($$ select subtotal, service_charge, tax, total from public.orders where id = %L $$, :'o1'),
  $$ values (150000::bigint, 7500::bigint, 24000::bigint, 181500::bigint) $$,
  'calc_order_totals saves the totals on the order'
);

select * from finish();
rollback;

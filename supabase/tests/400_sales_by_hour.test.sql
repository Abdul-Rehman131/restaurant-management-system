-- get_sales_summary.by_hour (S5, Admin dashboard): completed sales per local hour of the order
-- time (settings time zone), 24 entries in business-day order from the cut-off hour (BR-04).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(7);

update public.settings set tax_bps = 0, service_charge_bps = 0, timezone = 'Asia/Karachi',
                           day_cutoff_time = '04:00';
update public.orders set business_date = date '2000-01-01';

select tests.create_staff('bh.admin', 'admin') as admin \gset
select tests.create_staff('bh.cashier', 'cashier') as cashier \gset
select tests.create_item('BH Tea', 10000, false) as tea \gset

-- A completed Take Away order of n teas, placed at a given local time on 2026-10-24.
create function tests.sale(p_local timestamp, p_teas integer) returns uuid language plpgsql as $$
declare
  v_order uuid;
begin
  v_order := (tests.call_as((select id from public.profiles where username = 'bh.cashier'), format(
    $f$ select public.create_order(gen_random_uuid(), 'take_away', null, 'BH', null, jsonb_build_array(tests.line(%L, %s))) $f$,
    (select id from public.menu_items where name = 'BH Tea'), p_teas)) ->> 'order_id')::uuid;
  perform tests.call_as((select id from public.profiles where username = 'bh.cashier'), format(
    $f$ select public.record_payment(gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', %s))) $f$,
    v_order, (select total from public.orders where id = v_order)));
  update public.orders
     set created_at = p_local at time zone 'Asia/Karachi', business_date = date '2026-10-24'
   where id = v_order;
  return v_order;
end;
$$;

select tests.sale('2026-10-24 12:15', 1);   -- 12:00, Rs 100
select tests.sale('2026-10-24 12:50', 2);   -- 12:00, Rs 200
select tests.sale('2026-10-24 19:05', 3);   -- 19:00, Rs 300
select tests.sale('2026-10-25 01:30', 1);   -- 01:00 after midnight, same business day, Rs 100

select tests.call_as(:'admin', $$ select public.get_sales_summary('2026-10-24') $$) -> 'by_hour' as hours \gset

select is(jsonb_array_length(:'hours'::jsonb), 24, 'all 24 hours are listed');
select is((:'hours'::jsonb -> 0 ->> 'hour')::int, 4, 'starting at the cut-off hour (04:00)');
select is((:'hours'::jsonb -> 23 ->> 'hour')::int, 3, 'and ending at 03:00');
select is((select x from jsonb_array_elements(:'hours'::jsonb) x where (x ->> 'hour')::int = 12),
  '{"hour": 12, "orders": 2, "sales": 30000}'::jsonb, '12:00 has two orders, Rs 300');
select is((select x from jsonb_array_elements(:'hours'::jsonb) x where (x ->> 'hour')::int = 19),
  '{"hour": 19, "orders": 1, "sales": 30000}'::jsonb, '19:00 has one order');
select is((select x from jsonb_array_elements(:'hours'::jsonb) x where (x ->> 'hour')::int = 1),
  '{"hour": 1, "orders": 1, "sales": 10000}'::jsonb, 'an order at 01:30 counts at 01:00 of the same business day');
select is((select sum((x ->> 'sales')::bigint) from jsonb_array_elements(:'hours'::jsonb) x),
  (tests.call_as(:'admin', $$ select public.get_sales_summary('2026-10-24') $$) ->> 'gross_sales')::numeric,
  'the hours add up to the gross sales');

select * from finish();
rollback;

-- get_sales_summary (M9, done criterion 8): the basic daily report, computed live (G14; the
-- daily_summary job is P4). Admin only (spec 4: reports).
--   * p_business_date: NULL means the current business day (BR-04, private.business_date).
--   * Sales are Completed orders: fulfilled and fully paid (BR-12). Open and cancelled orders
--     are only counted.
--   * gross_sales = sum of totals; net_sales = subtotal - discount; service_charge and tax are
--     the stored server values (BR-16). average_order_value = gross / orders, rounded half up
--     in exact numeric (no floats, hard rule 5).
--   * by_type: every order type, also with 0. top_items: the 10 best sellers by quantity
--     (then sales), from non-cancelled lines; sales there is before discount.
-- Returns {business_date, orders_count, gross_sales, net_sales, discount, service_charge, tax,
--   average_order_value, cancelled_count, open_count, by_type: [{type, orders, sales}],
--   top_items: [{menu_item_id, name, quantity, sales}]}.
-- Errors: NOT_AUTHORIZED (42501).
create function public.get_sales_summary(p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_count bigint;
  v_gross bigint;
  v_net bigint;
  v_discount bigint;
  v_service bigint;
  v_tax bigint;
begin
  perform private.require_role('admin');
  v_date := coalesce(p_business_date, private.business_date(now()));

  select count(*), coalesce(sum(o.total), 0), coalesce(sum(o.subtotal - o.discount), 0),
         coalesce(sum(o.discount), 0), coalesce(sum(o.service_charge), 0), coalesce(sum(o.tax), 0)
    into v_count, v_gross, v_net, v_discount, v_service, v_tax
    from public.orders o
   where o.business_date = v_date and o.status = 'completed';

  return jsonb_build_object(
    'business_date', v_date,
    'orders_count', v_count,
    'gross_sales', v_gross,
    'net_sales', v_net,
    'discount', v_discount,
    'service_charge', v_service,
    'tax', v_tax,
    'average_order_value',
      case when v_count = 0 then 0 else private.round_to_unit(v_gross::numeric / v_count, 1, 'half_up') end,
    'cancelled_count',
      (select count(*) from public.orders o where o.business_date = v_date and o.status = 'cancelled'),
    'open_count',
      (select count(*) from public.orders o
        where o.business_date = v_date and o.status not in ('completed', 'cancelled')),
    'by_type', (
      select jsonb_agg(jsonb_build_object(
               'type', t.type, 'orders', coalesce(s.orders, 0), 'sales', coalesce(s.sales, 0)
             ) order by t.type)
        from unnest(enum_range(null::public.order_type)) as t(type)
        left join (
          select o.type, count(*) as orders, sum(o.total) as sales
            from public.orders o
           where o.business_date = v_date and o.status = 'completed'
           group by o.type
        ) s on s.type = t.type
    ),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'menu_item_id', x.menu_item_id, 'name', x.name, 'quantity', x.quantity, 'sales', x.sales
             ) order by x.quantity desc, x.sales desc, x.name)
        from (
          select i.menu_item_id,
                 (array_agg(i.name_snapshot order by i.created_at desc))[1] as name,
                 sum(i.quantity) as quantity,
                 sum(i.line_total) as sales
            from public.order_items i
            join public.orders o on o.id = i.order_id
           where o.business_date = v_date and o.status = 'completed' and not i.is_cancelled
           group by i.menu_item_id
           order by sum(i.quantity) desc, sum(i.line_total) desc
           limit 10
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_sales_summary(date) is
  'Daily report (M9): completed sales, order count, average, by type, top items. Admin only.';

revoke all on function public.get_sales_summary(date) from public, anon;
grant execute on function public.get_sales_summary(date) to authenticated;

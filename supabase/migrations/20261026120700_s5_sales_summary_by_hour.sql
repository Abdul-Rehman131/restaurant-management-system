-- get_sales_summary gains by_hour (S5, the Admin dashboard, plan 4.9): completed sales per
-- local hour (settings time zone) of the order's creation time, all 24 hours, in business-day
-- order starting at the cut-off hour (so 04:00 to 03:00 by default, BR-04). Everything else
-- is unchanged (s1_get_sales_summary).
-- by_hour: [{hour (0-23), orders, sales}].
create or replace function public.get_sales_summary(p_business_date date default null)
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
  v_timezone text;
  v_cutoff_hour integer;
begin
  perform private.require_role('admin');
  v_date := coalesce(p_business_date, private.business_date(now()));
  select s.timezone, extract(hour from s.day_cutoff_time)::integer into v_timezone, v_cutoff_hour
    from public.settings s where s.branch_id = private.default_branch_id();

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
    ), '[]'::jsonb),
    'by_hour', (
      select jsonb_agg(jsonb_build_object(
               'hour', h.hour, 'orders', coalesce(s.orders, 0), 'sales', coalesce(s.sales, 0)
             ) order by (h.hour - v_cutoff_hour + 24) % 24)
        from generate_series(0, 23) as h(hour)
        left join (
          select extract(hour from o.created_at at time zone v_timezone)::integer as hour,
                 count(*) as orders, sum(o.total) as sales
            from public.orders o
           where o.business_date = v_date and o.status = 'completed'
           group by 1
        ) s on s.hour = h.hour
    )
  );
end;
$$;

revoke all on function public.get_sales_summary(date) from public, anon;
grant execute on function public.get_sales_summary(date) to authenticated;

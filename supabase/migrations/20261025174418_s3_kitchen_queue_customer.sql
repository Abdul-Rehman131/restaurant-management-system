-- S3 kitchen screen: a Take Away ticket is called by the customer's name (plan 4.11 wireframe,
-- "TAKE AWAY · Ali"), so get_kitchen_queue also returns orders.customer_name (null for
-- Dine-In). Still no money field (G6). Replaces the S1 function; grants are kept.
-- Returns {"server_time", "tickets": [{batch_id, order_id, order_number, order_type,
--   table_number, customer_name, batch_no, is_addon, status, sent_at, preparing_at,
--   items: [{order_item_id, name, quantity, notes}]}]}.
create or replace function public.get_kitchen_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin', 'cashier', 'chef');
  return jsonb_build_object(
    'server_time', now(),
    'tickets', coalesce((
      select jsonb_agg(t.ticket order by t.sent_at, t.order_number, t.batch_no)
        from (
          select b.sent_at, o.order_number, b.batch_no, jsonb_build_object(
                   'batch_id', b.id,
                   'order_id', o.id,
                   'order_number', o.order_number,
                   'order_type', o.type,
                   'table_number', rt.number,
                   'customer_name', o.customer_name,
                   'batch_no', b.batch_no,
                   'is_addon', b.batch_no > 1,
                   'status', b.status,
                   'sent_at', b.sent_at,
                   'preparing_at', b.preparing_at,
                   'items', items.list
                 ) as ticket
            from public.order_batches b
            join public.orders o on o.id = b.order_id
            left join public.restaurant_tables rt on rt.id = o.table_id
            cross join lateral (
              select jsonb_agg(jsonb_build_object(
                       'order_item_id', i.id,
                       'name', i.name_snapshot,
                       'quantity', i.quantity,
                       'notes', i.notes
                     ) order by i.created_at, i.id) as list
                from public.order_items i
               where i.order_id = b.order_id and i.batch_no = b.batch_no
                 and i.needs_kitchen and not i.is_cancelled
            ) items
           where b.status in ('sent', 'preparing')
             and o.status not in ('completed', 'cancelled')
             and items.list is not null
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- Kitchen reads (M6, G6): the chef has no SELECT on orders, order_items or the menu, so the
-- kitchen screen reads only through these two RPCs. Neither returns a money field (no price,
-- cost, total, tax, discount, amount): RLS filters rows, not columns.

-- The live kitchen queue: one ticket per batch that is Sent or Preparing, oldest first (ties
-- by order number, then batch).
--   * Only kitchen lines (BR-07: needs_kitchen), not cancelled. Bottled drinks never appear.
--   * Batch 2 and later carry is_addon = true: the kitchen sees only the new batch (BR-06).
--   * server_time lets screens colour the ticket age (G11) without trusting the device clock.
-- Returns {"server_time": timestamptz, "tickets": [{batch_id, order_id, order_number,
--   order_type, table_number, batch_no, is_addon, status, sent_at, preparing_at,
--   items: [{order_item_id, name, quantity, notes}]}]}.
-- Errors: NOT_AUTHORIZED (42501).
create function public.get_kitchen_queue()
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

-- The Sold Out list (M6, BR-13): active menu items of active categories with their
-- availability, for the kitchen and the counter. No prices.
-- Returns {"items": [{menu_item_id, name, category_id, category_name, needs_kitchen,
--   is_available}]}, by category and item sort order.
-- Errors: NOT_AUTHORIZED (42501).
create function public.get_menu_availability()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin', 'cashier', 'chef');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'menu_item_id', m.id,
             'name', m.name,
             'category_id', c.id,
             'category_name', c.name,
             'needs_kitchen', m.needs_kitchen,
             'is_available', m.is_available
           ) order by c.sort_order, c.name, m.sort_order, m.name)
      from public.menu_items m
      join public.categories c on c.id = m.category_id
     where m.is_active and c.is_active
  ), '[]'::jsonb));
end;
$$;

comment on function public.get_kitchen_queue() is
  'Kitchen tickets per open batch, kitchen lines only, no money fields (M6, G6, BR-06, BR-07).';
comment on function public.get_menu_availability() is
  'Active menu items with Sold Out state for the kitchen and counter, no prices (M6, BR-13).';

revoke all on function public.get_kitchen_queue() from public, anon;
revoke all on function public.get_menu_availability() from public, anon;
grant execute on function public.get_kitchen_queue() to authenticated;
grant execute on function public.get_menu_availability() to authenticated;

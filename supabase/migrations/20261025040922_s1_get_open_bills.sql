-- get_open_bills (M7): the cashier's list of open orders. Bill Requested first (oldest
-- request first, spec 6.1 step 6), then the rest by age. Totals are the stored server values
-- (every write recalculates them through private.calc_order_totals); paid counts non-voided
-- payments only, and due = total - paid. Paid orders that are not fulfilled yet stay listed
-- (BR-12: Completed needs both). Admin and Cashier only (spec 4: payments).
-- Returns {"bills": [{order_id, order_number, type, status, payment_status, table_id,
--   table_number, waiter_id, waiter_name, customer_name, customer_phone, bill_requested,
--   bill_requested_at, created_at, subtotal, discount, service_charge, tax, total, paid,
--   due}]}.
-- Errors: NOT_AUTHORIZED (42501).
create function public.get_open_bills()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin', 'cashier');
  return jsonb_build_object('bills', coalesce((
    select jsonb_agg(jsonb_build_object(
             'order_id', o.id,
             'order_number', o.order_number,
             'type', o.type,
             'status', o.status,
             'payment_status', o.payment_status,
             'table_id', o.table_id,
             'table_number', rt.number,
             'waiter_id', o.waiter_id,
             'waiter_name', w.full_name,
             'customer_name', o.customer_name,
             'customer_phone', o.customer_phone,
             'bill_requested', o.bill_requested,
             'bill_requested_at', o.bill_requested_at,
             'created_at', o.created_at,
             'subtotal', o.subtotal,
             'discount', o.discount,
             'service_charge', o.service_charge,
             'tax', o.tax,
             'total', o.total,
             'paid', paid.amount,
             'due', greatest(o.total - paid.amount, 0)
           ) order by o.bill_requested desc, o.bill_requested_at, o.created_at, o.order_number)
      from public.orders o
      left join public.restaurant_tables rt on rt.id = o.table_id
      left join public.profiles w on w.id = o.waiter_id
      cross join lateral (
        select coalesce(sum(p.amount), 0)::bigint as amount
          from public.payments p where p.order_id = o.id and p.voided_at is null
      ) paid
     where o.status not in ('completed', 'cancelled')
  ), '[]'::jsonb));
end;
$$;

comment on function public.get_open_bills() is
  'Open orders for the cashier, Bill Requested first, with server totals, paid and due (M7).';

revoke all on function public.get_open_bills() from public, anon;
grant execute on function public.get_open_bills() to authenticated;

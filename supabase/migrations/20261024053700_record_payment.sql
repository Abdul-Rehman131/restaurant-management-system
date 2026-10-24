-- record_payment (T6, M7, BR-11, BR-12): one call records 1..n tenders that together pay the
-- full amount due. Pattern: docs/adr/001-business-logic-in-postgres.md.

-- Result of a payment request (also returned on idempotent replays).
create function private.payment_summary(p_order_id uuid, p_request_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'payment_status', o.payment_status,
    'total', o.total,
    'paid', (select coalesce(sum(p.amount), 0) from public.payments p
              where p.order_id = o.id and p.voided_at is null),
    'change_due', (select coalesce(sum(p.tendered - p.amount), 0) from public.payments p
                    where p.request_id = p_request_id and p.tendered is not null),
    'table_status', (select t.status from public.restaurant_tables t where t.id = o.table_id),
    'replayed', p_replayed
  )
  from public.orders o
  where o.id = p_order_id
$$;

-- p_tenders: [{"method": "cash"|"card", "amount": int, "tendered": int (cash only),
--              "reference": text (card only)}, ...]  amounts in minor units.
-- The tender amounts must add up exactly to the amount due (total minus non-voided
-- payments), otherwise nothing is written. Completes the order only if it is also fulfilled
-- (Dine-In: Served; Take Away: Ready), and then frees the table (BR-12).
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, ORDER_NOT_FOUND, ORDER_CANCELLED, ORDER_ALREADY_PAID, NOTHING_TO_PAY,
--   TENDERS_REQUIRED, TENDERS_TOO_MANY, TENDER_INVALID, TENDER_FIELD_NOT_ALLOWED,
--   TENDER_METHOD_INVALID, TENDER_AMOUNT_INVALID, TENDERED_INVALID, REFERENCE_INVALID,
--   PAYMENT_MISMATCH.
create function public.record_payment(p_request_id uuid, p_order_id uuid, p_tenders jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_previous_order uuid;
  v_tender jsonb;
  v_key text;
  v_method text;
  v_amount bigint;
  v_tendered bigint;
  v_reference text;
  v_tenders jsonb := '[]'::jsonb;
  v_sum bigint := 0;
  v_already_paid bigint;
  v_due bigint;
  v_fulfilled boolean;
begin
  -- 1. Role first (BR-11).
  perform private.require_role('admin', 'cashier');

  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- 2. Idempotency (BR-15): a retry of a successful payment returns the same result.
  perform pg_advisory_xact_lock(hashtextextended('record_payment:' || p_request_id::text, 0));
  select p.order_id into v_previous_order from public.payments p where p.request_id = p_request_id limit 1;
  if found then
    if v_previous_order is distinct from p_order_id then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return private.payment_summary(p_order_id, p_request_id, true);
  end if;

  -- 3. Lock the order: concurrent payments of the same bill are serialised.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  -- 4. Amount due, from totals recalculated by the one totals function.
  perform private.calc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  select coalesce(sum(p.amount), 0) into v_already_paid
    from public.payments p where p.order_id = p_order_id and p.voided_at is null;
  v_due := v_order.total - v_already_paid;
  if v_due <= 0 then
    raise exception 'NOTHING_TO_PAY' using errcode = 'P0001';
  end if;

  -- 5. Validate every tender before writing anything.
  if p_tenders is null or jsonb_typeof(p_tenders) <> 'array' or jsonb_array_length(p_tenders) = 0 then
    raise exception 'TENDERS_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_tenders) > 10 then
    raise exception 'TENDERS_TOO_MANY' using errcode = 'P0001';
  end if;

  for v_tender in select value from jsonb_array_elements(p_tenders) loop
    if jsonb_typeof(v_tender) <> 'object' then
      raise exception 'TENDER_INVALID' using errcode = 'P0001';
    end if;
    for v_key in select jsonb_object_keys(v_tender) loop
      if v_key not in ('method', 'amount', 'tendered', 'reference') then
        raise exception 'TENDER_FIELD_NOT_ALLOWED' using errcode = 'P0001',
          detail = format('field "%s" is not accepted', v_key);
      end if;
    end loop;

    v_method := v_tender ->> 'method';
    if coalesce(jsonb_typeof(v_tender -> 'method'), 'missing') <> 'string'
       or v_method not in ('cash', 'card') then
      raise exception 'TENDER_METHOD_INVALID' using errcode = 'P0001';
    end if;

    if coalesce(jsonb_typeof(v_tender -> 'amount'), 'missing') <> 'number'
       or (v_tender ->> 'amount') !~ '^[0-9]{1,15}$' then
      raise exception 'TENDER_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_amount := (v_tender ->> 'amount')::bigint;
    if v_amount <= 0 then
      raise exception 'TENDER_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    v_tendered := null;
    if coalesce(jsonb_typeof(v_tender -> 'tendered'), 'null') <> 'null' then
      if v_method <> 'cash'
         or jsonb_typeof(v_tender -> 'tendered') <> 'number'
         or (v_tender ->> 'tendered') !~ '^[0-9]{1,15}$'
         or (v_tender ->> 'tendered')::bigint < v_amount then
        raise exception 'TENDERED_INVALID' using errcode = 'P0001';
      end if;
      v_tendered := (v_tender ->> 'tendered')::bigint;
    end if;

    v_reference := null;
    if coalesce(jsonb_typeof(v_tender -> 'reference'), 'null') <> 'null' then
      v_reference := nullif(btrim(v_tender ->> 'reference'), '');
      if v_method <> 'card'
         or jsonb_typeof(v_tender -> 'reference') <> 'string'
         or coalesce(length(v_reference), 0) > 64 then
        raise exception 'REFERENCE_INVALID' using errcode = 'P0001';
      end if;
    end if;

    v_sum := v_sum + v_amount;
    v_tenders := v_tenders || jsonb_build_array(jsonb_build_object(
      'method', v_method, 'amount', v_amount, 'tendered', v_tendered, 'reference', v_reference));
  end loop;

  -- BR-11: the tenders must cover the amount due exactly. Raising here writes nothing.
  if v_sum <> v_due then
    raise exception 'PAYMENT_MISMATCH' using errcode = 'P0001',
      detail = format('tenders add up to %s, amount due is %s', v_sum, v_due);
  end if;

  -- 6. Write the tenders and mark the order paid.
  insert into public.payments (order_id, request_id, tender_no, method, amount, tendered,
                               reference, received_by)
  select p_order_id, p_request_id, t.ord::smallint, (t.tender ->> 'method')::public.payment_method,
         (t.tender ->> 'amount')::bigint, (t.tender ->> 'tendered')::bigint,
         t.tender ->> 'reference', v_user
    from jsonb_array_elements(v_tenders) with ordinality as t(tender, ord);

  update public.orders set payment_status = 'paid' where id = p_order_id;

  -- 7. BR-12: Completed only when fulfilled AND paid; completing a Dine-In order frees the table.
  v_fulfilled := case v_order.type
    when 'dine_in' then v_order.status = 'served'
    when 'take_away' then v_order.status = 'ready'
    when 'delivery' then v_order.status = 'delivered'
  end;

  if v_fulfilled then
    update public.orders set status = 'completed', completed_at = now() where id = p_order_id;
    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (p_order_id, v_order.status, 'completed', v_user);
    if v_order.table_id is not null then
      update public.restaurant_tables set status = 'available' where id = v_order.table_id;
    end if;
  end if;

  return private.payment_summary(p_order_id, p_request_id, false);
end;
$$;

comment on function public.record_payment(uuid, uuid, jsonb) is
  'Records Cash/Card (split) payment for the full amount due; completes the order if fulfilled (BR-11, BR-12, BR-15). See ADR 001.';

revoke all on function private.payment_summary(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_payment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_payment(uuid, uuid, jsonb) to authenticated;

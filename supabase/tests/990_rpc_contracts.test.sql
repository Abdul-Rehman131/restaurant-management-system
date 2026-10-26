-- RPC response contracts (ADR 002, condition 1). Each jsonb RPC's top-level keys must match
-- its Zod schema in packages/shared/src/schemas exactly. Change both together.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(33);

create function tests.keys(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_value) k
$$;

-- The keys of p_value plus p_extra, sorted (for "summary + one more key" responses).
create function tests.keys_plus(p_value jsonb, p_extra text[]) returns text[] language sql immutable as $$
  select array_agg(k order by k) from unnest(tests.keys(p_value) || p_extra) k
$$;

select tests.create_staff('rc.cashier', 'cashier') as cashier \gset
select tests.create_table(991) as t1 \gset
select tests.create_item('RC Water', 10000, false) as water \gset
select tests.create_item('RC Tikka', 60000) as tikka \gset
select tests.create_staff('rc.chef', 'chef') as chef \gset

-- orderSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'water')) as created \gset
select is(
  tests.keys(:'created'),
  array['bill_requested', 'business_date', 'discount', 'order_id', 'order_number', 'payment_status',
        'replayed', 'service_charge', 'status', 'subtotal', 'table_id', 'tax', 'total', 'type', 'waiter_id'],
  'create_order returns the orderSummary keys'
);

-- addItemsToOrderResponse (schemas/orders.ts): orderSummary + batch_no
select tests.call_as(:'cashier', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L))) $$,
  :'created'::jsonb ->> 'order_id', :'water')) as added \gset
select is(
  tests.keys(:'added'),
  array['batch_no', 'bill_requested', 'business_date', 'discount', 'order_id', 'order_number', 'payment_status',
        'replayed', 'service_charge', 'status', 'subtotal', 'table_id', 'tax', 'total', 'type', 'waiter_id'],
  'add_items_to_order returns orderSummary + batch_no'
);
-- (the bill changed: read the new total for the payment below)
select private.order_summary((:'created'::jsonb ->> 'order_id')::uuid, false) as created \gset

-- paymentSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.record_payment(gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('method', 'card', 'amount', %s))) $$,
  :'created'::jsonb ->> 'order_id', :'created'::jsonb ->> 'total')) as paid \gset
select is(
  tests.keys(:'paid'),
  array['change_due', 'order_id', 'order_number', 'paid', 'payment_status', 'replayed', 'status',
        'table_status', 'total'],
  'record_payment returns the paymentSummary keys'
);

-- setBatchStatusResponse (schemas/kitchen.ts)
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_kitchen \gset
select tests.call_as(:'chef', format(
  $$ select public.set_batch_status(gen_random_uuid(), %L, 'preparing') $$,
  (select id from public.order_batches where order_id = :'o_kitchen'))) as batch \gset
select is(
  tests.keys(:'batch'),
  array['batch_id', 'batch_no', 'batch_status', 'order_id', 'order_status', 'replayed'],
  'set_batch_status returns the setBatchStatusResponse keys'
);

-- setOrderStatusResponse = orderSummary (schemas/orders.ts)
select tests.call_as(:'cashier', format(
  $$ select public.set_order_status(gen_random_uuid(), %L, 'cancelled', 'Contract test') $$, :'o_kitchen')) as status_changed \gset
select is(tests.keys(:'status_changed'), tests.keys(:'created'), 'set_order_status returns the orderSummary keys');

-- cancelOrderResponse = orderSummary
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_cancel \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Contract test') $$, :'o_cancel'))),
  tests.keys(:'created'), 'cancel_order returns the orderSummary keys'
);

-- requestBillResponse = orderSummary
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_bill \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.request_bill(gen_random_uuid(), %L) $$, :'o_bill'))),
  tests.keys(:'created'), 'request_bill returns the orderSummary keys'
);

-- setItemAvailabilityResponse (schemas/menu.ts)
select is(
  tests.keys(tests.call_as(:'chef', format($$ select public.set_item_availability(gen_random_uuid(), %L, false) $$, tests.create_item('RC Sold Out', 5000)))),
  array['is_available', 'menu_item_id', 'replayed'], 'set_item_availability returns the setItemAvailabilityResponse keys'
);

-- removeOrCancelItemResponse (schemas/orders.ts): orderSummary + order_item_id
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'tikka', :'water')) ->> 'order_id' as o_item \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.remove_or_cancel_item(gen_random_uuid(), %L, 'Contract test') $$,
    (select id from public.order_items where order_id = :'o_item' and menu_item_id = :'water')))),
  tests.keys_plus(:'created', array['order_item_id']), 'remove_or_cancel_item returns orderSummary + order_item_id'
);

-- applyDiscountResponse = orderSummary
select tests.create_staff('rc.admin', 'admin') as admin \gset
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_discount \gset
select is(
  tests.keys(tests.call_as(:'admin', format($$ select public.apply_discount(gen_random_uuid(), %L, 100, 'Contract test') $$, :'o_discount'))),
  tests.keys(:'created'), 'apply_discount returns the orderSummary keys'
);

-- voidPaymentResponse (schemas/orders.ts): paymentSummary + payment_id
select is(
  tests.keys(tests.call_as(:'admin', format($$ select public.void_payment(gen_random_uuid(), %L, 'Contract test') $$,
    (select id from public.payments where order_id = (:'created'::jsonb ->> 'order_id')::uuid limit 1)))),
  tests.keys_plus(:'paid', array['payment_id']), 'void_payment returns paymentSummary + payment_id'
);

-- moveOrderTableResponse = orderSummary
select tests.create_staff('rc.waiter', 'waiter') as waiter \gset
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  tests.create_table(992), :'tikka')) ->> 'order_id' as o_move \gset
select is(
  tests.keys(tests.call_as(:'cashier', format($$ select public.move_order_table(gen_random_uuid(), %L, %L, %L) $$,
    :'o_move', tests.create_table(993), :'waiter'))),
  tests.keys(:'created'), 'move_order_table returns the orderSummary keys'
);

-- kitchenQueueResponse (schemas/kitchen.ts); nested keys are pinned in 290_kitchen_queue
select is(tests.keys(tests.call_as(:'chef', 'select public.get_kitchen_queue()')), array['server_time', 'tickets'],
  'get_kitchen_queue returns the kitchenQueueResponse keys');
-- menuAvailabilityResponse (schemas/menu.ts)
select is(tests.keys(tests.call_as(:'chef', 'select public.get_menu_availability()')), array['items'],
  'get_menu_availability returns the menuAvailabilityResponse keys');

-- openBillsResponse (schemas/orders.ts)
select is(
  tests.keys(tests.call_as(:'cashier', 'select public.get_open_bills()') #> '{bills,0}'),
  array['bill_requested', 'bill_requested_at', 'created_at', 'customer_name', 'customer_phone', 'discount', 'due',
        'order_id', 'order_number', 'paid', 'payment_status', 'service_charge', 'status', 'subtotal', 'table_id',
        'table_number', 'tax', 'total', 'type', 'waiter_id', 'waiter_name'],
  'get_open_bills returns the openBill keys'
);

-- salesSummaryResponse (schemas/reports.ts)
select is(
  tests.keys(tests.call_as(:'admin', 'select public.get_sales_summary()')),
  array['average_order_value', 'business_date', 'by_hour', 'by_type', 'cancelled_count', 'discount', 'gross_sales', 'net_sales',
        'open_count', 'orders_count', 'service_charge', 'tax', 'top_items'],
  'get_sales_summary returns the salesSummaryResponse keys'
);

select is(
  tests.keys(tests.call_as(:'admin', 'select public.get_sales_summary()') -> 'by_hour' -> 0),
  array['hour', 'orders', 'sales'], 'by_hour entries have the salesSummaryResponse keys'
);

-- ===== Admin (schemas/admin.ts) =====
select tests.call_as(:'admin', $$ select public.save_category(gen_random_uuid(), null, 'RC Soups') $$) as cat \gset
select is(tests.keys(:'cat'), array['category', 'created', 'replayed'], 'save_category returns saveCategoryResponse');
select is(tests.keys(:'cat'::jsonb -> 'category'), array['active_items', 'id', 'is_active', 'name', 'sort_order'],
  'categories have the adminCategory keys');
select tests.call_as(:'admin', format(
  $$ select public.save_menu_item(gen_random_uuid(), null, %L) $$,
  jsonb_build_object('category_id', :'cat'::jsonb -> 'category' ->> 'id', 'name', 'RC Soup', 'price', 100))) as itm \gset
select is(tests.keys(:'itm'), array['created', 'item', 'replayed'], 'save_menu_item returns saveMenuItemResponse');
select is(tests.keys(:'itm'::jsonb -> 'item'),
  array['category_id', 'cost_price', 'description', 'id', 'image_path', 'is_active', 'is_available', 'name',
        'needs_kitchen', 'prep_time_min', 'price', 'sort_order', 'updated_at'],
  'items have the adminMenuItem keys');
select is(tests.keys(tests.call_as(:'admin', 'select public.admin_menu()')), array['categories', 'items'],
  'admin_menu returns adminMenuResponse');
select is(tests.keys(tests.call_as(:'admin', format($$ select public.reorder_menu_items(gen_random_uuid(), %L, %L) $$,
  :'cat'::jsonb -> 'category' ->> 'id', array[:'itm'::jsonb -> 'item' ->> 'id']::uuid[]))),
  array['category_id', 'item_ids', 'replayed'], 'reorder_menu_items returns reorderMenuItemsResponse');
select is(tests.keys(tests.call_as(:'admin', format($$ select public.set_menu_item_active(gen_random_uuid(), %L, false, 'x') $$,
  :'itm'::jsonb -> 'item' ->> 'id'))), array['item', 'replayed'], 'set_menu_item_active returns setMenuItemActiveResponse');
select is(tests.keys(tests.call_as(:'admin', format($$ select public.set_category_active(gen_random_uuid(), %L, false, 'x') $$,
  :'cat'::jsonb -> 'category' ->> 'id'))), array['category', 'replayed'], 'set_category_active returns setCategoryActiveResponse');
select is(tests.keys(tests.call_as(:'admin', format($$ select public.reorder_categories(gen_random_uuid(), %L) $$,
  (select array_agg(id) from public.categories where is_active)))), array['category_ids', 'replayed'],
  'reorder_categories returns reorderCategoriesResponse');

select tests.call_as(:'admin', $$ select public.save_table(gen_random_uuid(), null, 989, 4, 'RC') $$) as tbl \gset
select is(tests.keys(:'tbl'), array['created', 'replayed', 'table'], 'save_table returns saveTableResponse');
select is(tests.keys(:'tbl'::jsonb -> 'table'), array['capacity', 'id', 'is_active', 'number', 'section', 'status'],
  'tables have the adminTable keys');
select is(tests.keys(tests.call_as(:'admin', format($$ select public.set_table_active(gen_random_uuid(), %L, false, 'x') $$,
  :'tbl'::jsonb -> 'table' ->> 'id'))), array['replayed', 'table'], 'set_table_active returns setTableActiveResponse');

select is(tests.keys(tests.call_as(:'admin', $$ select public.update_settings(gen_random_uuid(), '{"tax_bps": 0}') $$)),
  tests.keys_plus(tests.call_as(:'admin', 'select public.get_settings()'), array['replayed']),
  'update_settings returns updateSettingsResponse (get_settings + replayed)');
select is(tests.keys(tests.call_as(:'admin', $$ select public.preview_bill_totals('take_away', array[100]::bigint[], 0) $$)),
  array['discount', 'line_count', 'service_charge', 'subtotal', 'tax', 'total', 'type'],
  'preview_bill_totals returns billCheckResponse');

-- Staff (service_role, through the Edge Function): staffAdminResponse without the password.
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;
create function tests.as_service(p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  execute p_sql into v;
  perform tests.logout();
  return v;
end;
$f$;
select tests.as_service(format($$ select public.staff_admin_set_active(%L, gen_random_uuid(), %L, false, 'x') $$,
  :'admin', :'cashier')) as off \gset
select is(tests.keys(:'off'), array['replayed', 'sessions_revoked', 'staff'], 'staff_admin_set_active returns staffAdminResponse keys');
select is(tests.keys(:'off'::jsonb -> 'staff'), array['created_at', 'full_name', 'id', 'is_active', 'phone', 'role', 'username'],
  'staff rows have the adminStaff keys');

select * from finish();
rollback;

-- Security guards (T5). Schema-wide checks that fail as soon as a migration forgets RLS, a
-- fixed search_path, or leaks a grant to the API roles. The "probe" tests prove each guard
-- really detects a regression by creating a bad object inside this rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(14);

-- Functions the `authenticated` role may EXECUTE (the RPC allow-list). Update deliberately.
create function tests.authenticated_rpc_allowlist()
returns text[]
language sql
as $$
  select array[
    'public.add_items_to_order(p_request_id uuid, p_order_id uuid, p_items jsonb)',
    'public.admin_menu()',
    'public.admin_menu_item_costs()',
    'public.admin_order_item_costs(p_order_id uuid)',
    'public.admin_staff_directory()',
    'public.apply_discount(p_request_id uuid, p_order_id uuid, p_amount bigint, p_reason text)',
    'public.cancel_order(p_request_id uuid, p_order_id uuid, p_reason text)',
    'public.create_order(p_request_id uuid, p_type order_type, p_table_id uuid, p_customer_name text, p_customer_phone text, p_items jsonb, p_waiter_id uuid)',
    'public.get_kitchen_queue()',
    'public.get_menu_availability()',
    'public.get_open_bills()',
    'public.get_sales_summary(p_business_date date)',
    'public.get_settings()',
    'public.move_order_table(p_request_id uuid, p_order_id uuid, p_to_table_id uuid, p_waiter_id uuid)',
    'public.my_role()',
    'public.preview_bill_totals(p_type order_type, p_line_amounts bigint[], p_discount bigint)',
    'public.record_payment(p_request_id uuid, p_order_id uuid, p_tenders jsonb)',
    'public.remove_or_cancel_item(p_request_id uuid, p_order_item_id uuid, p_reason text)',
    'public.reorder_categories(p_request_id uuid, p_category_ids uuid[])',
    'public.reorder_menu_items(p_request_id uuid, p_category_id uuid, p_item_ids uuid[])',
    'public.request_bill(p_request_id uuid, p_order_id uuid)',
    'public.save_category(p_request_id uuid, p_category_id uuid, p_name text)',
    'public.save_menu_item(p_request_id uuid, p_menu_item_id uuid, p_item jsonb)',
    'public.save_table(p_request_id uuid, p_table_id uuid, p_number integer, p_capacity integer, p_section text)',
    'public.set_batch_status(p_request_id uuid, p_batch_id uuid, p_status batch_status)',
    'public.set_category_active(p_request_id uuid, p_category_id uuid, p_is_active boolean, p_reason text)',
    'public.set_item_availability(p_request_id uuid, p_menu_item_id uuid, p_is_available boolean)',
    'public.set_menu_item_active(p_request_id uuid, p_menu_item_id uuid, p_is_active boolean, p_reason text)',
    'public.set_order_status(p_request_id uuid, p_order_id uuid, p_status order_status, p_reason text)',
    'public.set_table_active(p_request_id uuid, p_table_id uuid, p_is_active boolean, p_reason text)',
    'public.update_settings(p_request_id uuid, p_changes jsonb)',
    'public.void_payment(p_request_id uuid, p_payment_id uuid, p_reason text)'
  ]::text[]
$$;

create function tests.public_tables_without_rls()
returns text[]
language sql
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$;

create function tests.functions_without_fixed_search_path(p_definer_only boolean)
returns text[]
language sql
as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                 order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prosecdef or not p_definer_only)
     and not coalesce('search_path=""' = any (p.proconfig), false)
$$;

create function tests.functions_executable_by(p_role text)
returns text[]
language sql
as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                 order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and has_function_privilege(p_role, p.oid, 'execute')
$$;

-- Tables/views where the role has any of the table privileges or (for SELECT/INSERT/UPDATE/
-- REFERENCES) the same privilege on any single column, plus sequences it can use.
create function tests.tables_with_privilege(p_role text, p_privileges text)
returns text[]
language sql
as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and case
       when c.relkind = 'S' then has_sequence_privilege(p_role, c.oid, 'USAGE,SELECT,UPDATE')
       when c.relkind in ('r', 'p', 'v', 'm') then
         has_table_privilege(p_role, c.oid, p_privileges)
         or has_any_column_privilege(
              p_role, c.oid,
              coalesce(nullif(array_to_string(array(
                select x from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) x
                 where position(x in upper(p_privileges)) > 0), ','), ''), 'REFERENCES'))
       else false
     end
$$;

-- RLS on every table
select is(tests.public_tables_without_rls(), '{}'::text[], 'every table in public has RLS enabled');

-- search_path
select is(
  tests.functions_without_fixed_search_path(true), '{}'::text[],
  'every SECURITY DEFINER function in public/private has search_path = '''''
);
select is(
  tests.functions_without_fixed_search_path(false), '{}'::text[],
  'every function in public/private has search_path = '''' (project convention)'
);

-- Function execution
select is(tests.functions_executable_by('anon'), '{}'::text[], 'anon cannot execute any function in public/private');
select is(
  tests.functions_executable_by('authenticated'), tests.authenticated_rpc_allowlist(),
  'authenticated can execute only the RPC allow-list'
);

-- Table privileges
select is(
  tests.tables_with_privilege('anon', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  '{}'::text[], 'anon has no privilege on any table, view or sequence in public'
);
select is(
  tests.tables_with_privilege('authenticated', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  '{}'::text[], 'authenticated cannot write any table (writes only through functions)'
);
select is(
  (select coalesce(array_agg(tablename || ':' || policyname order by 1), '{}')
     from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
  '{}'::text[], 'there are no INSERT, UPDATE, DELETE or ALL policies on public tables'
);

-- Schemas
select ok(
  not has_schema_privilege('anon', 'private', 'usage')
  and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the API roles have no access to the private schema'
);
select ok(not has_schema_privilege('anon', 'public', 'usage'), 'anon has no access to the public schema');

-- Probes: each guard catches a regression
create table public.guard_probe (id integer);
select is(
  tests.public_tables_without_rls(), '{guard_probe}'::text[],
  'probe: a new table without RLS is detected (the RLS guard would fail)'
);
select ok(
  not has_table_privilege('authenticated', 'public.guard_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.guard_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'probe: a new table gets no grants for the API roles by default'
);
create function public.guard_probe_fn()
returns integer
language sql
security definer
as $$ select 1 $$;
select is(
  tests.functions_without_fixed_search_path(true), '{"public.guard_probe_fn()"}'::text[],
  'probe: a SECURITY DEFINER function without search_path is detected'
);
select is(
  tests.functions_executable_by('anon') || tests.functions_executable_by('authenticated'),
  tests.authenticated_rpc_allowlist(),
  'probe: a new function is not executable by anon or authenticated by default'
);

select * from finish();
rollback;

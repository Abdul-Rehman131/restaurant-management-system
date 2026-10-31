-- Audit helpers for the Admin functions (S5, BR-24): archives and restores (BR-14), staff and
-- settings changes are written by triggers, like the S1 audit entries, so no function can
-- skip them.
--
-- Archived rows have no reason column. The function that archives sets the reason for its own
-- transaction with private.set_audit_reason(); the trigger reads it back. A row changed
-- without a reason (a migration, a fixture) is logged with reason NULL.

create function private.set_audit_reason(p_reason text)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('rms.audit_reason', coalesce(p_reason, ''), true) is null
$$;

create function private.audit_reason()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('rms.audit_reason', true), '')
$$;

-- AFTER UPDATE OF is_active trigger. TG_ARGV[0] is the action prefix (category, menu_item,
-- restaurant_table, staff): logs <prefix>.archived or <prefix>.restored with the reason.
create function private.audit_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active is distinct from old.is_active then
    perform private.audit(
      tg_argv[0] || case when new.is_active then '.restored' else '.archived' end,
      tg_table_name, new.id, private.audit_reason(),
      jsonb_build_object('is_active', old.is_active),
      jsonb_build_object('is_active', new.is_active));
  end if;
  return null;
end;
$$;

-- The keys whose values differ between two rows (as jsonb), with the old and the new values.
-- Columns in p_ignore (updated_at, ...) are left out. Returns NULL when nothing changed.
create function private.row_diff(p_old jsonb, p_new jsonb, p_ignore text[])
returns table (old_value jsonb, new_value jsonb)
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(o.key, o.value), jsonb_object_agg(o.key, p_new -> o.key)
    from jsonb_each(p_old) o
   where not o.key = any (p_ignore)
     and o.value is distinct from p_new -> o.key
  having count(*) > 0
$$;

revoke all on all functions in schema private from public, anon, authenticated;

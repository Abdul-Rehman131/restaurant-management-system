-- Auth helpers (T5): who is calling, and how a username maps to a login.

-- The caller's role, read from profiles by auth.uid() on every call. This is the source of
-- truth for every policy and function: deactivating a profile (is_active = false) removes all
-- access on the very next request, without waiting for the JWT to expire. Returns NULL for
-- anonymous callers, unknown users and deactivated staff.
-- SECURITY DEFINER so policies on `profiles` itself can use it without recursion.
create function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid() and p.is_active
$$;

comment on function public.my_role() is
  'Role of the calling user from profiles (NULL if anonymous, unknown or deactivated). Used by RLS policies; wrap as (select public.my_role()) so it runs once per statement.';

grant execute on function public.my_role() to authenticated;

-- Username login (Q3, G15). Staff sign in with a username and password. Supabase Auth needs an
-- email, so every staff login uses an internal address derived from the username:
--
--     staff_login_email('waiter1')  ->  'waiter1@staff.invalid'
--
-- `.invalid` is a reserved top-level domain (RFC 2606): mail to it can never be delivered, so
-- these addresses never reach a real person. Password resets are done by an Admin (P1), not by
-- email. The staff app applies the same mapping (packages/shared/src/auth.ts) before calling
-- signInWithPassword. Staff accounts are created only by an Admin (P1 staff-admin function,
-- service role); public sign-up is disabled.
create function public.staff_login_email(p_username text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_username text := lower(btrim(p_username));
begin
  if v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'USERNAME_INVALID' using errcode = 'P0001';
  end if;
  return v_username || '@staff.invalid';
end;
$$;

comment on function public.staff_login_email(text) is
  'Maps a staff username to its internal login email (<username>@staff.invalid). Mirrored in packages/shared/src/auth.ts.';

-- Only server-side code (Edge Functions with the service role) needs it; the browser computes
-- the same string itself.
grant execute on function public.staff_login_email(text) to service_role;

-- Every profile's username must match its login email, so the mapping can never drift.
create function private.check_profile_login_email()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.id;
  if v_email is distinct from public.staff_login_email(new.username) then
    raise exception 'PROFILE_EMAIL_MISMATCH' using errcode = 'P0001',
      detail = format('login email must be %s', public.staff_login_email(new.username));
  end if;
  return new;
end;
$$;

create trigger profiles_login_email_matches
  before insert or update of username on public.profiles
  for each row execute function private.check_profile_login_email();

revoke all on all functions in schema private from public, anon, authenticated;

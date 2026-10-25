-- Staff provisioning (T10): the profile half of "create a staff account". The login itself is
-- created first through the Auth admin API (confirmed <username>@staff.invalid email); this
-- function then adds its profile. Server-side only: EXECUTE is granted to service_role alone
-- (scripts/seed-staging.ts now, the Admin "create staff" Edge Function in P1). Browsers can
-- never call it.
--
-- SECURITY DEFINER because inserting a profile runs private.default_branch_id() (column
-- default) and the login-email trigger, which reads auth.users; the API roles have neither.
--
-- Idempotent on the auth user id instead of a request_id: calling it again for the same login
-- and username returns the same id and changes nothing.
create function public.create_staff_profile(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.profiles%rowtype;
begin
  select * into v_existing from public.profiles where id = p_user_id;
  if found then
    if v_existing.username = p_username then
      return v_existing.id;
    end if;
    raise exception 'PROFILE_EXISTS' using errcode = 'P0001',
      detail = 'this login already has a profile with another username';
  end if;

  if exists (select 1 from public.profiles where username = p_username) then
    raise exception 'USERNAME_TAKEN' using errcode = 'P0001';
  end if;

  -- The login-email trigger rejects a login that is not <username>@staff.invalid.
  insert into public.profiles (id, username, full_name, role)
  values (p_user_id, p_username, p_full_name, p_role);

  return p_user_id;
end;
$$;

comment on function public.create_staff_profile(uuid, text, text, public.app_role) is
  'Adds the profile for a staff login created through the Auth admin API. service_role only (seed-staging, P1 Admin Edge Function).';

revoke all on function public.create_staff_profile(uuid, text, text, public.app_role)
  from public, anon, authenticated;
grant execute on function public.create_staff_profile(uuid, text, text, public.app_role)
  to service_role;

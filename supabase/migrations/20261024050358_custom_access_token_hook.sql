-- Custom Access Token Hook (T5). Supabase Auth calls this for every token it issues (sign-in
-- and refresh). It adds the staff role to the JWT as `app_role`, which the staff app uses ONLY
-- to choose the screen to open. Security never trusts it: RLS and functions read the role
-- from profiles via public.my_role().
--
-- It also refuses tokens for unknown or deactivated staff, so a deactivated person cannot sign
-- in again or refresh a session. Their current token is already useless, because my_role()
-- returns NULL on the very next request.
--
-- Enabled locally in supabase/config.toml ([auth.hook.custom_access_token]). Staging and
-- production enable it in T10 (Authentication -> Hooks), pointing at this function.

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_is_active boolean;
begin
  select p.role, p.is_active
    into v_role, v_is_active
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  if v_role is null or not v_is_active then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'This staff account is not active.')
    );
  end if;

  return jsonb_set(event, '{claims,app_role}', to_jsonb(v_role::text));
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth hook: adds app_role (UI routing only) and blocks tokens for inactive staff.';

-- Only Supabase Auth may call it. It runs as its owner, so it can read profiles despite RLS.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

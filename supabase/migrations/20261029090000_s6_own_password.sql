-- Own password (S6, M1): every staff member can change their own password, and a new or
-- reset account must change its temporary password at the first sign-in.
--
--   * profiles.must_change_password: set by staff_admin_create and staff_admin_password_reset
--     (the Admin's temporary password), cleared only by account_password_changed, which the
--     `account` Edge Function calls after it has checked the current password and set the
--     new one.
--   * Enforced in the database, not only in the screens: while the flag is set, my_role() is
--     NULL (every RLS read and Realtime topic refuses) and private.require_role raises
--     PASSWORD_CHANGE_REQUIRED (every RPC refuses). Admin accounts included.
--   * my_role() also needs aal2 for an Admin now (S5 enforced it on RPCs only): a stolen Admin
--     password without the second factor reads nothing either.
--   * public.my_account(): what the app needs to route a signed-in person (active, role,
--     MFA step pending, password change pending). It answers in those states too, so the
--     screens can send the person to the right step instead of signing them out.

alter table public.profiles
  add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'True while the account has a temporary password (new or reset by an Admin). Every API call is refused until the person sets their own (S6).';

-- The caller's role for RLS, Realtime and require_role: NULL for anonymous, unknown and
-- deactivated callers, while a password change is pending, and for an Admin below aal2.
create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid()
     and p.is_active
     and not p.must_change_password
     and (p.role <> 'admin' or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;

-- Raises NOT_AUTHORIZED unless the caller is active staff with one of the given roles; then
-- MFA_REQUIRED for an Admin below aal2, then PASSWORD_CHANGE_REQUIRED while a temporary
-- password is set (the order the sign-in screens ask for them). Returns the caller's role.
create or replace function private.require_role(variadic p_roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pr.role, pr.is_active, pr.must_change_password into p
    from public.profiles pr where pr.id = auth.uid();
  if not found or not p.is_active or not p.role = any (p_roles) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p.role = 'admin' and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  if p.must_change_password then
    raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  return p.role;
end;
$$;

-- The signed-in person's account, for the app's routing: {active, role, mfa_step,
-- password_change}. active false for unknown or deactivated accounts (the app signs out).
create function public.my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active', coalesce(p.is_active, false),
    'role', p.role,
    'mfa_step', coalesce(p.role = 'admin' and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2', false),
    'password_change', coalesce(p.must_change_password, false))
    from (select 1) one
    left join public.profiles p on p.id = auth.uid()
$$;

comment on function public.my_account() is
  'The caller''s account state for UI routing: active, role, MFA step pending, password change pending (S6).';

create or replace function public.staff_admin_create(
  p_actor uuid,
  p_request_id uuid,
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_phone text,
  p_role public.app_role
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('username', p_username, 'full_name', p_full_name,
                                     'phone', p_phone, 'role', p_role);
  v_replay jsonb;
  v_username text := lower(btrim(p_username));
begin
  perform private.act_as_admin(p_actor);
  v_replay := private.replay('staff_admin_create', p_request_id, null, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  perform public.staff_login_email(v_username);
  perform private.check_staff_details(p_full_name, p_phone, p_role);
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'PROFILE_EXISTS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'USERNAME_TAKEN' using errcode = 'P0001';
  end if;

  -- The login-email trigger rejects a login that is not <username>@staff.invalid.
  -- A new login starts with a temporary password: it must be changed at the first sign-in.
  insert into public.profiles (id, username, full_name, phone, role, must_change_password)
  values (p_user_id, v_username, btrim(p_full_name), nullif(btrim(p_phone), ''), p_role, true);

  return private.remember('staff_admin_create', p_request_id, null,
    jsonb_build_object('staff', private.admin_staff(p_user_id)), v_args);
end;
$$;

create or replace function public.staff_admin_password_reset(p_actor uuid, p_request_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  p public.profiles%rowtype;
  v_revoked integer;
begin
  perform private.act_as_admin(p_actor);
  v_replay := private.replay('staff_admin_password_reset', p_request_id, p_user_id, '{}');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.id = p_actor then
    raise exception 'CANNOT_CHANGE_SELF' using errcode = 'P0001';
  end if;
  if not p.is_active then
    raise exception 'STAFF_INACTIVE' using errcode = 'P0001';
  end if;

  -- The new password is temporary again: changed at the next sign-in.
  update public.profiles set must_change_password = true where id = p.id;
  v_revoked := private.revoke_sessions(p.id);
  perform private.audit('staff.password_reset', 'profiles', p.id, null, null,
    jsonb_build_object('sessions_revoked', v_revoked));

  return private.remember('staff_admin_password_reset', p_request_id, p_user_id,
    jsonb_build_object('staff', private.admin_staff(p.id), 'sessions_revoked', v_revoked), '{}');
end;
$$;

-- account_password_replay: the stored result of a password change for this request id, or
-- NULL (the Edge Function checks it first: a retry must not check the old password again).
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT.
create function public.account_password_replay(p_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  return private.replay('account_password_changed', p_request_id, p_user_id, '{}');
end;
$$;

-- account_password_changed: the `account` Edge Function has checked the current password and
-- set the new one; this clears the temporary-password flag, writes staff.password_changed to
-- the audit log and ends every other session of the person (p_keep_session stays signed in).
-- Returns {password_change: false, sessions_revoked, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT.
create function public.account_password_changed(
  p_user_id uuid,
  p_request_id uuid,
  p_keep_session uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_revoked integer;
begin
  if p_user_id is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  -- Act as the person, so the replay and the audit log record them.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  v_replay := private.replay('account_password_changed', p_request_id, p_user_id, '{}');
  if v_replay is not null then
    return v_replay;
  end if;

  perform 1 from public.profiles where id = p_user_id and is_active for update;
  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  update public.profiles set must_change_password = false where id = p_user_id;
  delete from auth.sessions s
   where s.user_id = p_user_id and s.id is distinct from p_keep_session;
  get diagnostics v_revoked = row_count;
  perform private.audit('staff.password_changed', 'profiles', p_user_id, null, null,
    jsonb_build_object('sessions_revoked', v_revoked));

  return private.remember('account_password_changed', p_request_id, p_user_id,
    jsonb_build_object('password_change', false, 'sessions_revoked', v_revoked), '{}');
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;
revoke all on function public.account_password_replay(uuid, uuid) from public, anon, authenticated;
revoke all on function public.account_password_changed(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_password_replay(uuid, uuid) to service_role;
grant execute on function public.account_password_changed(uuid, uuid, uuid) to service_role;
revoke all on function public.staff_admin_create(uuid, uuid, uuid, text, text, text, public.app_role) from public, anon, authenticated;
revoke all on function public.staff_admin_password_reset(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_admin_create(uuid, uuid, uuid, text, text, text, public.app_role) to service_role;
grant execute on function public.staff_admin_password_reset(uuid, uuid, uuid) to service_role;

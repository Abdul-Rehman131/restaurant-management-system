-- Staff administration (M1, S5): the database half of the staff-admin Edge Function
-- (supabase/functions/staff-admin). EXECUTE for service_role only: the browser can never call
-- these, it calls the Edge Function, which
--   1. verifies the caller's JWT with Auth, checks my_role() = 'admin' as the caller and the
--      session's aal2 (MFA), and only then
--   2. calls these functions with the service key, passing the caller as p_actor, and does the
--      Auth half (create the login, set a password, ban or unban) with the Auth admin API.
--
-- Each function first acts as p_actor for its own transaction (private.act_as_admin): auth.uid()
-- becomes the actor, so private.require_role('admin') re-checks that the actor is an active
-- Admin, and the request id replay (BR-15) and the audit log (BR-24) record the actor.
--
--   staff_admin_replay          a stored result for a request id, or NULL (create, reset)
--   staff_admin_create          the profile of a login the function has just created
--   staff_admin_update          full name, phone, role
--   staff_admin_set_active      deactivate (reason required; sessions revoked) or reactivate
--   staff_admin_password_reset  audit + revoke sessions (the function sets the new password)
--   staff_admin_mfa_reset       audit + revoke sessions (the function removes the TOTP
--                               factors; the user sets up a new one at the next sign-in)
--
-- Guards: no Admin can deactivate, demote or reset the password or MFA of their own account
-- (CANNOT_CHANGE_SELF: a second Admin does it), and the last active Admin can never be
-- deactivated or demoted (LAST_ADMIN). Active Admin rows are locked first, so two Admins
-- demoting each other at the same moment cannot both succeed.
--
-- Deactivation is immediate: my_role() is NULL for the user on the next request, the token
-- hook refuses new tokens, and here every session (and its refresh tokens) is deleted. The
-- Edge Function also bans the login.

-- Acts as p_actor in this transaction and checks that the actor is an active Admin. The Edge
-- Function has already checked the caller's aal2, so the claims say aal2.
create function private.act_as_admin(p_actor uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform private.require_role('admin');
end;
$$;

create function private.admin_staff(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'phone', p.phone,
    'role', p.role, 'is_active', p.is_active, 'created_at', p.created_at)
    from public.profiles p
   where p.id = p_id
$$;

-- Deletes every session of the user (refresh tokens go with them). Returns how many.
create function private.revoke_sessions(p_user_id uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Locks the active Admins, then refuses if p_user_id is the only one left.
create function private.check_not_last_admin(p_user_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform 1 from public.profiles p where p.role = 'admin' and p.is_active for update;
  if not exists (select 1 from public.profiles p
                  where p.role = 'admin' and p.is_active and p.id <> p_user_id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;
end;
$$;

-- Validated staff details. Errors: FULL_NAME_INVALID, PHONE_INVALID, ROLE_REQUIRED.
create function private.check_staff_details(p_full_name text, p_phone text, p_role public.app_role)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 100 then
    raise exception 'FULL_NAME_INVALID' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_phone)), 0) > 30 then
    raise exception 'PHONE_INVALID' using errcode = 'P0001';
  end if;
  if p_role is null then
    raise exception 'ROLE_REQUIRED' using errcode = 'P0001';
  end if;
end;
$$;

-- staff_admin_replay: the stored result of p_function for this request id, with
-- "replayed": true, or NULL when the request id is new.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT.
create function public.staff_admin_replay(
  p_actor uuid,
  p_request_id uuid,
  p_function text,
  p_target_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.act_as_admin(p_actor);
  if p_function not in ('staff_admin_create', 'staff_admin_password_reset', 'staff_admin_mfa_reset') then
    raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
  end if;
  return private.replay(p_function, p_request_id, p_target_id, p_args);
end;
$$;

-- staff_admin_create: adds the profile for the login p_user_id (<username>@staff.invalid,
-- created by the Edge Function). Returns {staff: {...}, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT, USERNAME_INVALID,
--   USERNAME_TAKEN, PROFILE_EXISTS, PROFILE_EMAIL_MISMATCH, FULL_NAME_INVALID, PHONE_INVALID,
--   ROLE_REQUIRED.
create function public.staff_admin_create(
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
  insert into public.profiles (id, username, full_name, phone, role)
  values (p_user_id, v_username, btrim(p_full_name), nullif(btrim(p_phone), ''), p_role);

  return private.remember('staff_admin_create', p_request_id, null,
    jsonb_build_object('staff', private.admin_staff(p_user_id)), v_args);
end;
$$;

-- staff_admin_update: full name, phone and role. A role change revokes the user's sessions,
-- so they sign in again and land on the new role's screens (the JWT role claim that picks the
-- screens would otherwise stay stale until it expires). Returns {staff: {...},
-- sessions_revoked, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT, STAFF_NOT_FOUND,
--   FULL_NAME_INVALID, PHONE_INVALID, ROLE_REQUIRED, CANNOT_CHANGE_SELF, LAST_ADMIN.
create function public.staff_admin_update(
  p_actor uuid,
  p_request_id uuid,
  p_user_id uuid,
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
  v_args jsonb := jsonb_build_object('full_name', p_full_name, 'phone', p_phone, 'role', p_role);
  v_replay jsonb;
  p public.profiles%rowtype;
  v_revoked integer := 0;
begin
  perform private.act_as_admin(p_actor);
  v_replay := private.replay('staff_admin_update', p_request_id, p_user_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.check_staff_details(p_full_name, p_phone, p_role);
  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.role = 'admin' and p_role <> 'admin' then
    if p.id = p_actor then
      raise exception 'CANNOT_CHANGE_SELF' using errcode = 'P0001';
    end if;
    if p.is_active then
      perform private.check_not_last_admin(p.id);
    end if;
  end if;

  update public.profiles
     set full_name = btrim(p_full_name), phone = nullif(btrim(p_phone), ''), role = p_role
   where id = p.id
     and (full_name, phone, role) is distinct from (btrim(p_full_name), nullif(btrim(p_phone), ''), p_role);
  if p.role <> p_role then
    v_revoked := private.revoke_sessions(p.id);
  end if;

  return private.remember('staff_admin_update', p_request_id, p_user_id,
    jsonb_build_object('staff', private.admin_staff(p.id), 'sessions_revoked', v_revoked), v_args);
end;
$$;

-- staff_admin_set_active: deactivate (reason required; every session is revoked) or
-- reactivate. Returns {staff: {...}, sessions_revoked, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT, ACTIVE_REQUIRED,
--   STAFF_NOT_FOUND, REASON_REQUIRED, REASON_TOO_LONG, CANNOT_CHANGE_SELF, LAST_ADMIN.
create function public.staff_admin_set_active(
  p_actor uuid,
  p_request_id uuid,
  p_user_id uuid,
  p_is_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_args jsonb := jsonb_build_object('is_active', p_is_active, 'reason', p_reason);
  v_replay jsonb;
  p public.profiles%rowtype;
  v_reason text;
  v_revoked integer := 0;
begin
  perform private.act_as_admin(p_actor);
  v_replay := private.replay('staff_admin_set_active', p_request_id, p_user_id, v_args);
  if v_replay is not null then
    return v_replay;
  end if;

  if p_is_active is null then
    raise exception 'ACTIVE_REQUIRED' using errcode = 'P0001';
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_is_active then
    v_reason := private.clean_text(p_reason, 300, 'REASON_TOO_LONG');
    if not p.is_active then
      perform private.set_audit_reason(v_reason);
      update public.profiles set is_active = true where id = p.id;
    end if;
  else
    v_reason := private.require_reason(p_reason);
    if p.id = p_actor then
      raise exception 'CANNOT_CHANGE_SELF' using errcode = 'P0001';
    end if;
    if p.is_active then
      if p.role = 'admin' then
        perform private.check_not_last_admin(p.id);
      end if;
      perform private.set_audit_reason(v_reason);
      update public.profiles set is_active = false where id = p.id;
    end if;
    v_revoked := private.revoke_sessions(p.id);
  end if;

  return private.remember('staff_admin_set_active', p_request_id, p_user_id,
    jsonb_build_object('staff', private.admin_staff(p.id), 'sessions_revoked', v_revoked), v_args);
end;
$$;

-- staff_admin_password_reset: audits the reset and revokes every session of the user, so the
-- old password's sessions end. The Edge Function then sets the new temporary password.
-- Returns {staff: {...}, sessions_revoked, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT, STAFF_NOT_FOUND,
--   STAFF_INACTIVE, CANNOT_CHANGE_SELF.
create function public.staff_admin_password_reset(p_actor uuid, p_request_id uuid, p_user_id uuid)
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

  v_revoked := private.revoke_sessions(p.id);
  perform private.audit('staff.password_reset', 'profiles', p.id, null, null,
    jsonb_build_object('sessions_revoked', v_revoked));

  return private.remember('staff_admin_password_reset', p_request_id, p_user_id,
    jsonb_build_object('staff', private.admin_staff(p.id), 'sessions_revoked', v_revoked), '{}');
end;
$$;

-- staff_admin_mfa_reset: for a lost authenticator. Audits the reset and revokes every session
-- of the user; the Edge Function then removes the user's MFA factors, so the next sign-in sets
-- up a new one. Returns {staff: {...}, sessions_revoked, replayed}.
-- Errors: NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED, REQUEST_ID_CONFLICT, STAFF_NOT_FOUND,
--   STAFF_INACTIVE, CANNOT_CHANGE_SELF.
create function public.staff_admin_mfa_reset(p_actor uuid, p_request_id uuid, p_user_id uuid)
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
  v_replay := private.replay('staff_admin_mfa_reset', p_request_id, p_user_id, '{}');
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

  v_revoked := private.revoke_sessions(p.id);
  perform private.audit('staff.mfa_reset', 'profiles', p.id, null, null,
    jsonb_build_object('sessions_revoked', v_revoked));

  return private.remember('staff_admin_mfa_reset', p_request_id, p_user_id,
    jsonb_build_object('staff', private.admin_staff(p.id), 'sessions_revoked', v_revoked), '{}');
end;
$$;

-- Staff changes in the audit log (BR-24): staff.created, staff.updated (the changed values of
-- full_name, phone, role), staff.deactivated / staff.reactivated (with the reason).
create function private.audit_profiles()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d record;
begin
  if tg_op = 'INSERT' then
    perform private.audit('staff.created', 'profiles', new.id, null, null,
      jsonb_build_object('username', new.username, 'full_name', new.full_name, 'role', new.role));
    return null;
  end if;

  select * into d from private.row_diff(
    jsonb_build_object('full_name', old.full_name, 'phone', old.phone, 'role', old.role),
    jsonb_build_object('full_name', new.full_name, 'phone', new.phone, 'role', new.role),
    '{}');
  if d.old_value is not null then
    perform private.audit('staff.updated', 'profiles', new.id, null, d.old_value, d.new_value);
  end if;
  if new.is_active is distinct from old.is_active then
    perform private.audit(
      case when new.is_active then 'staff.reactivated' else 'staff.deactivated' end,
      'profiles', new.id, private.audit_reason(),
      jsonb_build_object('is_active', old.is_active), jsonb_build_object('is_active', new.is_active));
  end if;
  return null;
end;
$$;

create trigger profiles_audit
  after insert or update on public.profiles
  for each row execute function private.audit_profiles();

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.staff_admin_replay(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.staff_admin_create(uuid, uuid, uuid, text, text, text, public.app_role) from public, anon, authenticated;
revoke all on function public.staff_admin_update(uuid, uuid, uuid, text, text, public.app_role) from public, anon, authenticated;
revoke all on function public.staff_admin_set_active(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.staff_admin_password_reset(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.staff_admin_mfa_reset(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_admin_replay(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.staff_admin_create(uuid, uuid, uuid, text, text, text, public.app_role) to service_role;
grant execute on function public.staff_admin_update(uuid, uuid, uuid, text, text, public.app_role) to service_role;
grant execute on function public.staff_admin_set_active(uuid, uuid, uuid, boolean, text) to service_role;
grant execute on function public.staff_admin_password_reset(uuid, uuid, uuid) to service_role;
grant execute on function public.staff_admin_mfa_reset(uuid, uuid, uuid) to service_role;

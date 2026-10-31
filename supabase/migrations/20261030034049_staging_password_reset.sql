-- ops_password_reset: the database half of `pnpm seed:staging -- --reset-password=<username>`,
-- for an account nobody can reset in the app (for example the only Admin, password unknown).
-- Same effect as an Admin's reset (staff_admin_password_reset): the password becomes temporary
-- (must_change_password), every session ends, and the audit log records it. The script then
-- sets the new password through the Auth admin API.
--
-- service_role only: the secret key never reaches a browser, and the script refuses every
-- project except staging. There is no calling Admin, so it acts as the person for the replay log
-- and the audit entry (as account_password_changed does); the reason marks it as an operator
-- reset. Errors: NOT_AUTHORIZED (42501), STAFF_NOT_FOUND, STAFF_INACTIVE, REQUEST_ID_REQUIRED,
-- REQUEST_ID_CONFLICT.
create function public.ops_password_reset(p_request_id uuid, p_user_id uuid)
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
  if p_user_id is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  v_replay := private.replay('ops_password_reset', p_request_id, p_user_id, '{}');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not p.is_active then
    raise exception 'STAFF_INACTIVE' using errcode = 'P0001';
  end if;

  update public.profiles set must_change_password = true where id = p.id;
  v_revoked := private.revoke_sessions(p.id);
  perform private.audit('staff.password_reset', 'profiles', p.id,
    'operator reset (pnpm seed:staging --reset-password)', null,
    jsonb_build_object('sessions_revoked', v_revoked));

  return private.remember('ops_password_reset', p_request_id, p_user_id,
    jsonb_build_object('username', p.username, 'password_change', true,
                       'sessions_revoked', v_revoked), '{}');
end;
$$;

comment on function public.ops_password_reset(uuid, uuid) is
  'Operator password reset (seed-staging --reset-password): temporary password flag, sessions ended, audited. service_role only.';

revoke all on function public.ops_password_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ops_password_reset(uuid, uuid) to service_role;

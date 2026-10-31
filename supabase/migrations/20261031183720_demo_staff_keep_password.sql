-- Fixed demo passwords for a STAGING demo: an account can carry keep_password, so its password
-- is not treated as temporary (no forced change at sign-in, S6), even after a reset. Only
-- public.ops_demo_account (service_role, `pnpm seed:staging --demo-staff --set-demo-passwords`)
-- sets it; no app role can, and Admins never see or change it.

alter table public.profiles add column keep_password boolean not null default false;

comment on column public.profiles.keep_password is
  'Demo account: its password is never treated as temporary (no forced change). Set only by ops_demo_account (service_role).';

-- A temporary password is pending only when it is not a kept (demo) password.
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
     and not (p.must_change_password and not p.keep_password)
     and (p.role <> 'admin' or private.admin_mfa_ok())
$$;

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
  select pr.role, pr.is_active, pr.must_change_password and not pr.keep_password as pending
    into p
    from public.profiles pr where pr.id = auth.uid();
  if not found or not p.is_active or not p.role = any (p_roles) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p.role = 'admin' and not private.admin_mfa_ok() then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  if p.pending then
    raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  return p.role;
end;
$$;

create or replace function public.my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active', coalesce(p.is_active, false),
    'role', p.role,
    'mfa_step', coalesce(p.role = 'admin' and not private.admin_mfa_ok(), false),
    'password_change', coalesce(p.must_change_password and not p.keep_password, false),
    'admin_mfa', coalesce((select s.require_admin_mfa from public.settings s
                            where s.branch_id = private.default_branch_id()), true))
    from (select 1) one
    left join public.profiles p on p.id = auth.uid()
$$;

-- Marks an existing, active account as a demo account: its full name, keep_password, and no
-- pending password change. service_role only; audited; running it again changes nothing more.
-- Errors: NOT_AUTHORIZED (42501), STAFF_NOT_FOUND, STAFF_INACTIVE.
create function public.ops_demo_account(p_user_id uuid, p_full_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
begin
  if p_user_id is null or nullif(btrim(p_full_name), '') is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not p.is_active then
    raise exception 'STAFF_INACTIVE' using errcode = 'P0001';
  end if;
  if p.full_name is distinct from btrim(p_full_name) or not p.keep_password or p.must_change_password then
    update public.profiles
       set full_name = btrim(p_full_name), keep_password = true, must_change_password = false
     where id = p.id;
    perform private.audit('staff.demo_account', 'profiles', p.id,
      'pnpm seed:staging --demo-staff', null, jsonb_build_object('keep_password', true));
  end if;
  return jsonb_build_object('username', p.username, 'role', p.role);
end;
$$;

comment on function public.ops_demo_account(uuid, text) is
  'Staging demo: sets the full name and keep_password on an active account, clears a pending password change. service_role only; audited.';

revoke all on function public.ops_demo_account(uuid, text) from public, anon, authenticated;
grant execute on function public.ops_demo_account(uuid, text) to service_role;

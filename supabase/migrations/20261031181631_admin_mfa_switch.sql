-- Admin two-step sign-in switch, for a STAGING demo (default ON everywhere).
--
-- Spec 7.4 asks for multi-factor login for Admins, and that stays the default: every place that
-- required aal2 for an Admin now asks private.admin_mfa_ok(), which is aal2 OR the switch is off.
-- Only public.ops_set_require_admin_mfa can change the switch: service_role (the secret key, via
-- `pnpm seed:staging --admin-mfa on|off`), never an app role, not even Admin, and
-- update_settings does not accept the key. Every change is in the audit log.

alter table public.settings add column require_admin_mfa boolean not null default true;

comment on column public.settings.require_admin_mfa is
  'Admins need the second sign-in step (aal2). Default true; only ops_set_require_admin_mfa (service_role) changes it, for a staging demo.';

-- True when the caller's session satisfies the Admin MFA rule: aal2, or the switch is off.
create function private.admin_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not coalesce((select s.require_admin_mfa from public.settings s
                        where s.branch_id = private.default_branch_id()), true)
$$;

revoke all on function private.admin_mfa_ok() from public, anon, authenticated;

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
  select pr.role, pr.is_active, pr.must_change_password into p
    from public.profiles pr where pr.id = auth.uid();
  if not found or not p.is_active or not p.role = any (p_roles) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p.role = 'admin' and not private.admin_mfa_ok() then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  if p.must_change_password then
    raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  return p.role;
end;
$$;

-- Also says whether Admins need the second step (admin_mfa), so the Admin account menu can say
-- when it is off. Answered for any signed-in caller: it is not a secret.
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
    'password_change', coalesce(p.must_change_password, false),
    'admin_mfa', coalesce((select s.require_admin_mfa from public.settings s
                            where s.branch_id = private.default_branch_id()), true))
    from (select 1) one
    left join public.profiles p on p.id = auth.uid()
$$;

-- Menu photos: my_role() already includes the Admin MFA rule, so the policy no longer reads the
-- JWT itself (it would ignore the switch).
drop policy menu_images_admin_insert on storage.objects;
create policy menu_images_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (select public.my_role()) = 'admin'
    and name ~ '^items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );
comment on policy menu_images_admin_insert on storage.objects is
  'Menu photos: Admin (my_role(), so aal2 while require_admin_mfa) uploads new items/<uuid>.webp objects only.';

-- The switch itself. service_role only. Returns the new value; audited when it changes.
create function public.ops_set_require_admin_mfa(enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_branch uuid := private.default_branch_id();
  v_old boolean;
begin
  if enabled is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select require_admin_mfa into v_old from public.settings where branch_id = v_branch for update;
  if v_old is distinct from enabled then
    update public.settings set require_admin_mfa = enabled where branch_id = v_branch;
    perform private.audit('settings.admin_mfa_changed', 'settings', v_branch,
      'pnpm seed:staging --admin-mfa', jsonb_build_object('require_admin_mfa', v_old),
      jsonb_build_object('require_admin_mfa', enabled));
  end if;
  return jsonb_build_object('require_admin_mfa', enabled, 'changed', v_old is distinct from enabled);
end;
$$;

comment on function public.ops_set_require_admin_mfa(boolean) is
  'Turns the Admin second sign-in step on or off (staging demo). service_role only; audited.';

revoke all on function public.ops_set_require_admin_mfa(boolean) from public, anon, authenticated;
grant execute on function public.ops_set_require_admin_mfa(boolean) to service_role;

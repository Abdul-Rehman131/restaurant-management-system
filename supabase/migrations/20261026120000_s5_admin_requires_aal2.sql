-- MFA enforcement (M1, spec 7.4, plan T8 "enforcement is P1"): an Admin must have verified a
-- TOTP code in this session (JWT claim aal = aal2) before any Admin RPC runs. The check sits
-- in private.require_role, which every business function and Admin read calls first, so no
-- function can forget it. Other roles are unchanged (they have no second factor in P1).
--
-- my_role() stays as it is: RLS policies and the account-status check must keep working for
-- an Admin who has signed in but not yet entered the code (the MFA screen itself).
-- Errors: NOT_AUTHORIZED (42501), MFA_REQUIRED (42501).
create or replace function private.require_role(variadic p_roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.my_role();
begin
  if v_role is null or not v_role = any (p_roles) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_role = 'admin' and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

revoke all on function private.require_role(public.app_role[]) from public, anon, authenticated;

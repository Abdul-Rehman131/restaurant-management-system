-- Menu photos bucket (S5): public read, WebP only, 1 MiB, uploads by an Admin with aal2 only,
-- only new items/<uuid>.webp names, no overwrite and no delete. Storage applies these
-- policies as the caller's database role, as here.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

select tests.create_staff('ph.admin', 'admin') as admin \gset
select tests.create_staff('ph.cashier', 'cashier') as cashier \gset
select tests.create_staff('ph.waiter', 'waiter') as waiter \gset
select tests.create_staff('ph.chef', 'chef') as chef \gset
select tests.create_staff('ph.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';

create function tests.upload(p_name text, p_bucket text default 'menu-images') returns text language sql as $$
  select format($f$ insert into storage.objects (bucket_id, name) values (%L, %L) $f$, p_bucket, p_name)
$$;
create function tests.photo() returns text language sql volatile as $$
  select 'items/' || gen_random_uuid() || '.webp'
$$;
-- 'ok', or 'denied' for a row-level security refusal (Storage answers 403).
create function tests.upload_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
declare
  v_outcome text;
begin
  begin
    if p_user is null then perform tests.login_as_anon(); else perform tests.login_as(p_user, p_aal); end if;
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v_outcome := case when sqlstate = 'XTEST' then 'ok'
                      when sqlerrm like '%row-level security%' or sqlstate = '42501' then 'denied'
                      else sqlerrm end;
  end;
  perform tests.logout();
  return v_outcome;
end;
$$;

-- ===== The bucket =====
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'menu-images' $$,
  $$ values (true, 1048576::bigint, array['image/webp']) $$,
  'menu-images is public, 1 MiB, WebP only');

-- ===== Upload =====
select is(tests.upload_as(:'admin', tests.upload(tests.photo())), 'ok', 'an Admin with aal2 uploads a photo');
select is(tests.upload_as(:'admin', tests.upload(tests.photo()), 'aal1'), 'denied', 'an Admin without the MFA step cannot');
select is(tests.upload_as(:'cashier', tests.upload(tests.photo())), 'denied', 'a cashier cannot');
select is(tests.upload_as(:'waiter', tests.upload(tests.photo())), 'denied', 'a waiter cannot');
select is(tests.upload_as(:'chef', tests.upload(tests.photo())), 'denied', 'a chef cannot');
select is(tests.upload_as(:'former', tests.upload(tests.photo())), 'denied', 'a deactivated Admin cannot');
select is(tests.upload_as(null, tests.upload(tests.photo())), 'denied', 'anon cannot');
select is(tests.upload_as(:'admin', tests.upload('items/photo.png')), 'denied', 'only items/<uuid>.webp names');
select is(tests.upload_as(:'admin', tests.upload('other/' || gen_random_uuid() || '.webp')), 'denied', 'only the items folder');
select is(tests.upload_as(:'admin', tests.upload(tests.photo(), 'avatars')), 'denied', 'no other bucket');

-- ===== No overwrite, no delete =====
select tests.photo() as kept \gset
insert into storage.objects (bucket_id, name) values ('menu-images', :'kept');
select tests.login_as(:'admin');
update storage.objects set name = 'items/00000000-0000-0000-0000-000000000000.webp' where name = :'kept';
select tests.logout();
select is((select count(*)::int from storage.objects where name = :'kept'), 1, 'an Admin cannot rename (overwrite) a photo');
-- Storage refuses direct DELETEs on its tables itself; the policies must not allow one either.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%menu-images%'),
  0, 'no UPDATE or DELETE policy exists for menu photos');
select isnt(tests.upload_as(:'admin', tests.upload(:'kept')), 'ok', 'nor upload over an existing name');

-- ===== Reading the rows =====
select tests.login_as(:'admin');
select is((select count(*)::int from storage.objects where name = :'kept'), 1, 'an Admin sees the photo rows');
select tests.logout();
select tests.login_as(:'cashier');
select is((select count(*)::int from storage.objects where name = :'kept'), 0, 'a cashier does not (files are public by URL)');
select tests.logout();
select tests.login_as_anon();
select is((select count(*)::int from storage.objects where name = :'kept'), 0, 'nor anon');
select tests.logout();

select * from finish();
rollback;

-- Menu photos (M2, S5): the menu-images Storage bucket.
--
--   * Public read: the photo URLs are public, like the menu itself (the customer site in P2).
--   * Write: Admin only, with aal2 (MFA), and only new objects named items/<uuid>.webp. The
--     browser resizes and converts every photo to WebP before the upload (admin chunk).
--   * Limits on the bucket: image/webp only, at most 1 MiB.
--   * No UPDATE or DELETE policy: an object is never overwritten or removed (a new photo is a
--     new name; save_menu_item checks that the object exists). A replaced photo stays in the
--     bucket, which costs little and keeps old links working.
-- The role comes from public.my_role() (profiles), never from the JWT app_role claim.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 1048576, array['image/webp'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

create policy menu_images_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (select public.my_role()) = 'admin'
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and name ~ '^items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );

-- Storage reads the new row back after the insert, so the Admin needs SELECT as well.
create policy menu_images_admin_select
  on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and (select public.my_role()) = 'admin');

comment on policy menu_images_admin_insert on storage.objects is
  'Menu photos: Admin (aal2) uploads new items/<uuid>.webp objects only (my_role(), not the JWT).';
comment on policy menu_images_admin_select on storage.objects is
  'Menu photos: Admin may read the object rows (the files themselves are public).';

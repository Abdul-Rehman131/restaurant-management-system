# Backup and restore

What is backed up, how, how often, and how a restore is proven. Written for the real staging
and production projects; the local stack has a one-command check of the same idea
(`pnpm db:restore-check`).

## What holds the restaurant's data

| What | Where | In a database backup? |
|---|---|---|
| Orders, payments, menu, tables, settings, staff profiles, audit log | Postgres, schema `public` | Yes |
| Staff logins, passwords (hashed), MFA factors, sessions | Postgres, schema `auth` | Yes |
| Photo records (which file belongs to which item) | Postgres, schema `storage` | Yes |
| The photo files themselves | Supabase Storage (bucket `menu-images`) | **No**: copied separately (below) |
| Code, migrations, settings of the app | Git | Not needed: redeploy from Git |

## Automatic backups (Supabase)

- **Pro plan (required before go-live):** daily backups kept 7 days, restored from the
  dashboard (**Database → Backups**). Point-in-time recovery is a paid add-on; decide at
  go-live whether the restaurant needs it (losing at most one day of data vs. minutes).
- **Free plan (staging):** no backups you can download or restore from the dashboard. The
  weekly manual backup below is the only copy.

## Weekly manual backup (owner or developer, 10 minutes)

Do this every week on production, and before every risky change (a large migration, a plan
change). The reminder is in [setup-checklist.md](setup-checklist.md) ("Weekly").

1. On your own computer, open the password vault and copy the production **database
   connection string** (Project Settings → Database → Connection string, *Session pooler* or
   *Direct*, with the database password). Never paste it into a chat, file or Git.
2. In PowerShell, in an empty folder **outside** the repository:
   ```powershell
   $env:DB_URL = Read-Host -MaskInput 'Database connection string'
   $day = Get-Date -Format 'yyyy-MM-dd'
   pnpm --dir "<repo>" exec supabase db dump --db-url $env:DB_URL -f "roles-$day.sql" --role-only
   pnpm --dir "<repo>" exec supabase db dump --db-url $env:DB_URL -f "schema-$day.sql"
   pnpm --dir "<repo>" exec supabase db dump --db-url $env:DB_URL -f "data-$day.sql" --use-copy --data-only
   Remove-Item Env:DB_URL
   ```
   The three files together are the backup (roles, structure, data). Supabase's own schemas
   are left out on purpose; they come with every new project.
3. Copy the photos: in the dashboard, **Storage → menu-images**, select all, download (or use
   any S3 tool with the project's S3 keys, kept in the vault). Keep them next to the dump.
4. Put the folder in the restaurant's encrypted backup place (an encrypted drive or a
   private cloud folder only the owner and the developer can open). Keep at least the last 4
   weeks. The files contain staff names and phone numbers: treat them like the vault.
5. Write the date in the backup log (who, when, where it is stored).

## Restore (into a NEW project, never over the live one)

Use this to recover, and once before go-live to prove the backup works.

1. Create a fresh Supabase project (same region), or use the staging project when testing.
2. In the new project, enable the access token hook and MFA as in
   [setup-checklist.md](setup-checklist.md) 4.6 and 4.7, after step 3.
3. Restore, in this order, with the new project's connection string:
   ```powershell
   $env:NEW_DB_URL = Read-Host -MaskInput 'NEW database connection string'
   psql --single-transaction --variable ON_ERROR_STOP=1 `
     --file "roles-<day>.sql" --file "schema-<day>.sql" `
     --command 'SET session_replication_role = replica' --file "data-<day>.sql" `
     --dbname $env:NEW_DB_URL
   Remove-Item Env:NEW_DB_URL
   ```
   `session_replication_role = replica` loads the data without firing triggers again (the
   audit log and the Realtime broadcasts would otherwise run for every row).
4. Upload the photos into the new project's `menu-images` bucket with the same names.
5. **Verify** before anyone uses it:
   - Row counts: run `select count(*)` for `public.orders`, `public.order_items`,
     `public.payments`, `public.menu_items`, `public.profiles`, `auth.users` on the old
     project (or the counts written in the backup log) and the new one; they must match.
   - Totals: the sum of `public.payments.amount` (not voided) and of `public.orders.total`
     for the last business day must match the dashboard of the old project.
   - Sign in as an Admin (the MFA code still works: factors are restored), open Dashboard,
     Menu (photos visible) and Staff.
6. Point the apps at the new project (the two `VITE_SUPABASE_*` values in Vercel, then
   redeploy), deploy the Edge Functions to it (setup checklist 4.7), and tell the staff.

## The local check (proven)

`pnpm db:restore-check` does steps 1 to 5 against the local stack in one go: a full
`pg_dump` (custom format), a restore into an empty database, and a row-count comparison of
every `public` table plus `auth.users`, `auth.identities`, `auth.mfa_factors`,
`auth.sessions`, `storage.buckets` and `storage.objects`. It prints PASS or FAIL. Add
`-- --keep backups/local.dump` to keep the dump (the `backups/` folder and `*.dump` files are
git-ignored).

## What a backup does not cover

- Photo files (step 3 copies them separately).
- Secrets (database password, service key, Edge Function secrets, Vercel variables): they
  are in the vault and the platforms, never in a backup file.
- Anything after the last backup: on the Free plan, up to a week of orders. This is why the
  live restaurant needs the Pro plan (daily backups) before go-live.

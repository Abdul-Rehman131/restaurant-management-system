# Restaurant Management System

Real-time restaurant system: a staff PWA (waiter, kitchen, cashier, admin) and a customer
website on one Supabase order pipeline. Spec: [docs/spec.md](docs/spec.md). Current plan:
[docs/plan-phase0.md](docs/plan-phase0.md).

> **This repository is public.** Never commit secrets, keys, `.env` files, or private owner or
> business data. GitHub secret scanning and push protection are enabled.

## Requirements

- Node 24 LTS (`.nvmrc`) and pnpm 10 (`corepack enable`)
- Docker Desktop, running (for the local Supabase stack)

## First-time setup

```sh
pnpm install
pnpm db:start        # first run downloads the Supabase images (a few minutes)
pnpm dev             # staff app http://localhost:5173, customer site http://localhost:5174
```

Local Supabase: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, email
inbox (Mailpit) `http://127.0.0.1:54324`. `pnpm db:status` prints the local URLs and the
local-only demo keys. Those keys are the same on every machine and are not secrets.

**Local demo data** (`supabase/seed.sql`, loaded by `pnpm db:reset`, never on cloud projects):
the fake "Ember Kitchen (Demo)" restaurant with demo rates (16% tax, 5% service charge), 30
menu items, 12 tables, and six demo staff logins (username / `demo-password-123`): `admin`,
`cashier`, `waiter1`, `waiter2`, `chef` and `rider`, plus `former`, a deactivated account that
must be refused. Local only.

**Staff app env:** copy `.env.example` to `apps/staff-app/.env.local` and fill in
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `pnpm db:status` (the local API
URL and the `sb_publishable_...` key). The file is git-ignored. Never use a secret key there:
the app refuses to start with one. `pnpm build` fails when either value is missing.

Staff log in with a **username**. The app maps it to the internal login email
`<username>@staff.invalid` (`public.staff_login_email()` in SQL, `staffLoginEmail()` in
`packages/shared`). That domain is reserved and can never receive mail. Staff accounts are
created only by an Admin; public sign-up is disabled.

## Demo logins (local only)

`pnpm db:reset` loads `supabase/seed.sql`, which creates these demo staff accounts on your
**local** stack only. Sign in with the **username** (not an email) and the password
`demo-password-123`:

| Username  | Role                                            | Lands on                  |
| --------- | ----------------------------------------------- | ------------------------- |
| `admin`   | Admin (skip the two-step set-up prompt locally) | `/admin`                  |
| `cashier` | Cashier                                         | `/cashier`                |
| `waiter1` | Waiter                                          | `/waiter`                 |
| `waiter2` | Waiter                                          | `/waiter`                 |
| `chef`    | Chef                                            | `/kitchen`                |
| `rider`   | Rider (no screens until P3)                     | a "no screens yet" notice |

The seed also has `former`, a deactivated waiter whose sign-in is refused. These accounts
exist only after `pnpm db:reset` on a local stack. They are never created on staging or
production, where staff accounts are made by an Admin.

## Commands

| Command                                              | What it does                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`                            | Run or build all apps                                                                                                                                                                                                                             |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Quality gate (CI runs the same)                                                                                                                                                                                                                   |
| `pnpm db:start` / `db:stop` / `db:status`            | Start, stop or inspect the local Supabase stack                                                                                                                                                                                                   |
| `pnpm db:new <name>`                                 | Create `supabase/migrations/<timestamp>_<name>.sql`                                                                                                                                                                                               |
| `pnpm db:reset`                                      | Rebuild the local DB from all migrations, then run `supabase/seed.sql`                                                                                                                                                                            |
| `pnpm db:test`                                       | Run the pgTAP tests in `supabase/tests/`                                                                                                                                                                                                          |
| `pnpm db:lint`                                       | Lint the database schema and functions                                                                                                                                                                                                            |
| `pnpm db:types`                                      | Regenerate `packages/shared/src/database.types.ts` from the local DB                                                                                                                                                                              |
| `pnpm seed:staging`                                  | Create the staging staff accounts by hand (see Deployment); `-- --local` tries it locally                                                                                                                                                         |
| `pnpm brand:icons`                                   | Regenerate favicon and PWA icons from `packages/ui/brand/logo-mark.svg`                                                                                                                                                                           |
| `pnpm build && pnpm size`                            | Build, then check the initial-JS bundle budgets (plan 4.10)                                                                                                                                                                                       |
| `pnpm --filter @rms/ui test`                         | Contrast check for both themes (text 4.5:1, UI 3:1); also runs in `pnpm test`                                                                                                                                                                     |
| `pnpm test`                                          | Unit tests (Vitest, money helpers) and the contrast check                                                                                                                                                                                         |
| `pnpm e2e`                                           | Playwright on the dev server: sign-in and role routing against local Supabase (`pnpm db:start` first), plus the /dev/ui gallery with axe in light, dark, LTR and RTL (first run: `pnpm --filter @rms/staff-app exec playwright install chromium`) |
| `pnpm --filter @rms/staff-app e2e:pwa`               | After `pnpm build`: PWA update toast on a production preview                                                                                                                                                                                      |
| `pnpm dev`, then open http://localhost:5173/dev/ui   | Component gallery (development builds only); `?theme=dark&dir=rtl&density=desk`                                                                                                                                                                   |

## Database change workflow

1. `pnpm db:new <short_name>`, for example `pnpm db:new create_orders`.
2. Write the SQL by hand. One concern per migration. Every table gets RLS; every function is
   `security definer` with `set search_path = ''` and checks the caller's role.
3. `pnpm db:reset`: the migration must apply cleanly from zero.
4. Add or extend pgTAP tests in `supabase/tests/`, then run `pnpm db:test`. Every role must be covered.
5. `pnpm db:lint` and `pnpm db:types`.
6. Commit the migration, its tests and the regenerated types **in the same PR**.

Rules:

- **Never edit a migration that has been merged.** Fix forward with a new migration.
- Never change staging or production in the Supabase dashboard. Migrations are deployed from Git (T10).
- `supabase db diff` is only a helper for drafting SQL. Always review its output by hand.
- `supabase/seed.sql` is local-only demo data. It never runs on cloud projects.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and on pull
requests to `main` and `develop`. It uses **no secrets**: the database jobs start a local
Supabase stack inside the runner. A new push cancels the older run of the same branch. Actions
are pinned to commit SHAs and Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml))
proposes weekly updates for actions and npm packages.

| Job              | What it checks                                                                                                                               | Same check locally                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `quality`        | ESLint, TypeScript, Prettier, Vitest, contrast of both themes                                                                                | `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`                                                                |
| `database`       | Supabase (database container only), every migration from zero plus seed, pgTAP, schema lint, and that `database.types.ts` matches the schema | `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types && git diff --exit-code packages/shared/src/database.types.ts` |
| `build-and-size` | Production build of both apps, then the bundle budgets (plan 4.10); a budget exceeded fails the job                                          | `pnpm build && pnpm size`                                                                                                      |
| `e2e`            | Supabase (auth, REST, Realtime), Chromium, the Playwright suite on phone and desktop, then the PWA update test on a production preview       | `pnpm db:start`, then `pnpm e2e`, then `pnpm --filter @rms/staff-app build && pnpm --filter @rms/staff-app e2e:pwa`            |
| `secrets`        | gitleaks over the **full** git history                                                                                                       | [gitleaks](https://github.com/gitleaks/gitleaks) installed: `gitleaks git --redact -v .`                                       |
| `ci`             | Passes only when every job above passed (or was skipped). **This is the one required status check.**                                         |                                                                                                                                |

- Changes that touch only `docs/` or Markdown files skip `database`, `build-and-size` and `e2e`;
  `quality` and `secrets` always run.
- When `e2e` fails, the Playwright HTML report and traces are attached to the run as the
  `playwright-report` artifact (open a trace with `pnpm --filter @rms/staff-app exec playwright show-trace <zip>`).
- In CI, a failed Playwright test is retried once; a pass on retry shows as "flaky" in the summary.
- Never add a `pull_request_target` trigger or a repository secret to this workflow. Deployment
  secrets (T10) live only in GitHub Environments used by the deploy workflows.

## Environments

|            | Backend                                                                                   | Front ends                                                   |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Local      | `pnpm db:start` (Docker)                                                                  | `pnpm dev`                                                   |
| Staging    | Supabase project ref `aqxmdmkforcucmktwmjj`, `ap-southeast-1`                             | Vercel Hobby, branch `develop`; PR previews also use staging |
| Production | **Deferred** (see "Before go-live" in [docs/setup-checklist.md](docs/setup-checklist.md)) | Vercel Pro or Cloudflare Pages (D14)                         |

## Deployment (staging)

- **Front ends:** the Vercel Git integration builds `apps/staff-app` and `apps/customer-web`
  (two projects). Every push to `develop` updates the staging sites; every PR gets a preview
  that talks to the **staging** backend. `apps/*/vercel.json` holds the SPA rewrite, cache and
  security headers, and turns off deployments from `main` until go-live. The staff-app build
  fails if `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` is missing.
- **Database:** [`.github/workflows/db-deploy.yml`](.github/workflows/db-deploy.yml) runs on
  every push to `develop`: link staging, drift check
  ([`scripts/check-migration-drift.mjs`](scripts/check-migration-drift.mjs): fails if staging
  has a migration Git does not, or if a pending migration is older than one already applied),
  `supabase db push --dry-run`, then `supabase db push`. Migrations only: `seed.sql` never
  runs on a cloud project. Its secrets live in the GitHub Environment `staging`, which only
  `develop` can use; it never runs on pull requests or forks.
- **Keep-alive:** [`.github/workflows/staging-keepalive.yml`](.github/workflows/staging-keepalive.yml)
  pings the staging Auth health endpoint weekly (no secrets) so the free project does not
  pause. GitHub runs schedules from `main` only, so the weekly ping starts once it is on `main`.
- **Off switch:** both workflows run only when the repository variable `STAGING_DEPLOY_ENABLED`
  is `true`; otherwise their jobs are skipped (not failed). Set it last, once the staging
  secrets and variables exist ([docs/setup-checklist.md](docs/setup-checklist.md), 4.5).
- **Staging staff accounts:** `pnpm seed:staging`, run by hand on your machine with the staging
  secret key in your shell for that one command (steps in
  [docs/setup-checklist.md](docs/setup-checklist.md), 4.6). It creates `admin`, `cashier`,
  `waiter` and `chef` and prints each new password once. `pnpm seed:staging -- --local` tries
  it on the local stack.

## Rollback (staging)

Git is the source of truth: roll back by changing Git, then let the pipeline deploy.

1. **Front end broke, database fine.** On GitHub, open the merged PR → **Revert** → merge the
   revert PR into `develop`. Vercel redeploys the previous code. To restore service before
   that lands: Vercel → project → **Deployments** → the last good deployment → **⋯ → Instant
   Rollback** (staging is the Hobby projects' "Production", so this is available). The next
   deploy from `develop` replaces it, so still merge the revert.
2. **A migration broke something.** Never edit or delete a migration that has been deployed,
   and never fix staging in the dashboard. Write a **forward fix**: `pnpm db:new fix_<what>`
   that undoes or corrects the change, with pgTAP tests, in a PR to `develop`. `db-deploy`
   applies it. Each migration runs in a transaction, so a migration that fails is not recorded
   and changes nothing; fix it in a new commit and push again.
3. **Front end and database changed together.** Ship migrations that old front ends can still
   use (add first, remove later). Then step 1 alone is a safe rollback, and the database is
   fixed forward when needed (step 2).
4. **`db-deploy` reports drift.** Someone changed staging outside Git. Do not force it. Find
   the change (`supabase migration list --linked`), turn it into a migration in Git (or
   repair the history with `supabase migration repair`, only after review), then push again.
5. **Staging data is damaged.** Staging holds demo data only. As a last resort the owner can
   rebuild it by hand: `supabase db reset --linked` (re-runs every migration on staging and
   **deletes all staging data**), then check the access token hook is still enabled and re-run
   `pnpm seed:staging`. Never on production.

Production rollback (Pro backups and point-in-time restore) is written at go-live.

## Troubleshooting

- **`db:start` or `db:reset` fails right after the first install:** run it again. The first
  run can time out while images start. `pnpm db:stop`, then `pnpm db:start`, gives a clean restart.
- **Port already in use (54321–54324):** another Supabase stack is running. Run
  `npx supabase stop --all`.

# Plan: Phase 0 (Foundation) and outline of Phase 1 (MVP)

Status: **Draft for approval**. No code is written until this plan is approved.
Source of truth: [spec.md](spec.md) (converted from the Word file). Date: 24 October 2026.

---

## 0. Spec review: conflicts, gaps and ambiguities

Each item has a proposed resolution. Items marked **(Q)** need the owner and are listed in section 7.

| # | Finding | Proposed resolution |
|---|---|---|
| G1 | **Optimistic updates vs spec 7.3.** The UI brief asks for optimistic updates, but the spec says a screen never changes a status before the server confirms. | Optimistic only for local state: cart edits, filters, tabs. For status and money actions the button reacts at once (pressed and pending state in under 100 ms), and the screen changes only on server confirmation (about 200 to 400 ms). Sold Out uses the same rule. |
| G2 | **Add-ons after Ready or Served.** The transition table has no path back from Ready or Served, but 6.1 step 5 allows Add More Items after Served. | Kitchen state lives on `order_batches`. The order status is **derived** from its batches: a new kitchen batch moves a Ready or Served order back to Accepted (system transition, written to history). The transition table is extended to allow this. |
| G3 | **Order-level vs batch-level Preparing and Ready.** `set_order_status` (Appendix B) is order-level, but BR-06 and BR-08 and the `order_batches.status` column are batch-level. | The chef acts on **batches** (`set_batch_status`). The order status is recalculated in the same transaction. `set_order_status` remains for Served, Cancelled and the P3 delivery states. |
| G4 | **"Waiter: own tables"** has no table-to-waiter assignment in the data model, and a waiter must see every table's status to pick a free one. | All waiters see all tables' status. "Own" means `orders.waiter_id = me`. Handing over to another waiter is a Cashier or Admin action **(Q4)**. |
| G5 | **"Remove item before sent"** assumes unsent items exist in the database. With a client-side cart they do not. | The cart lives on the device until Send. Every item in the database counts as sent, so after send it can only be cancelled with a reason (BR-09). This simplifies `remove_or_cancel_item`. |
| G6 | **"Chef sees no prices"** cannot be done with RLS alone, because RLS filters rows, not columns. | The chef has no SELECT on `orders` or `order_items`. The kitchen reads through `get_kitchen_queue()`, which returns no money fields. Realtime payloads carry only IDs. |
| G7 | **The totals formula is undefined:** tax-inclusive or exclusive prices; the order of discount, service charge and tax; whether service charge applies to take away; rounding; discount as % or fixed. **(Q1, Q6)** | Assumed until answered: prices exclusive of tax; `base = subtotal - discount`; service charge on `base` for Dine-In only; tax on `base`; round half up once per order. All of this sits in one function, `calc_order_totals`. **Implemented in T4** as `settings` columns with these defaults, so the owner's answer changes data, not schema. See [pricing-rules.md](pricing-rules.md). |
| G8 | **Payments.** Is a split payment one call or several partial payments? Cash tendered and change are not modelled, there is no card reference, and refunds or voids after payment are not covered **(Q8)**. | One `record_payment` call with 1 to n tenders whose sum equals the amount due. Cash `tendered` is stored and change is shown. An optional card reference is stored. No partial payments in P1. **Void (agreed for P1):** Admin only, with a reason. The schema (T4) is in place: payments are immutable, and a void is a one-time, trigger-enforced change. The `void_payment` function comes in P1. |
| G9 | **Take Away payment timing.** Flow 6.2 pays after Ready, while many counters take payment first **(Q5)**. | Both are allowed. Payment sets `payment_status = paid`. The order completes when it is both paid and fulfilled (BR-12), whichever comes last. |
| G10 | **Time zone missing.** The business-day cut-off (BR-04) depends on local time, but `settings` has no time zone. | Add `settings.timezone` (default `Asia/Karachi`, to be confirmed). Calculate the business date in SQL only. |
| G11 | **Kitchen age thresholds** (green, yellow, red) are not defined. | Add `kitchen_warn_min` (default 10) and `kitchen_late_min` (default 20) to settings. |
| G12 | **M3 "move order to another table"** has no backend operation, and merging tables or splitting a bill is not mentioned. | Add `move_order_table` (Waiter for own orders, Cashier, Admin) in P1. Merge and split bill go to P5 unless requested. |
| G13 | **Table status is stored and also derivable** from open orders, which risks drift. "Bill Requested" is an order flag but shows as a table status. | Keep `restaurant_tables.status`, written **only** by the order functions in the same transaction. A partial unique index enforces BR-05, and a test checks consistency. |
| G14 | **Phase boundaries.** P0 says "deployed skeleton apps" (plural), while the website is P2. Admin MFA is M1 (P1). There is no phase for the `daily_summary` job. There is no JavaScript budget for the staff app. | The P0 customer site is a placeholder page, deployed only to set up the pipeline and the 200 KB budget gate. MFA is enabled in P0 and enforced in P1. M9 reports are computed live in P1; `daily_summary` comes in P4. Staff budget: see 4.10. |
| G15 | **Shared devices** (kitchen tablet, counter PC) and staff without email addresses are not addressed **(Q3)**. | Default: one account per person; username login mapped to an internal email; a "switch user" action on shared devices. |
| G16 | **The order number caps at 999 a day** (`NNN`). | This is fine at about 100 orders a day. The number grows to 4 digits instead of failing. |

---

## 1. Assumptions

1. Team: 2 developers full time, A for backend and database, B for frontend and design system. Both do CI. A third developer shortens P1, not P0 (D11).
2. Supabase is approved (D1). There are 2 cloud projects, staging and production, plus the local Docker stack. Region: **`ap-southeast-1` (Singapore)** for both.
3. GitHub (one repo), Vercel and Sentry accounts are owned by the client, and developers are invited **(Q2)**.
4. Currency is PKR, stored in paisa (×100) so that a later switch to a currency with decimals needs no schema change **(Q1)**.
5. English UI first. The Urdu and RTL structure is in place from P0, and translations are added when requested (D9).
6. Two front ends from day one (spec 8.1). The staff app is the only real P0 app; customer-web is a deployable placeholder.
7. The core P1 order schema is created **in P0**, so that `create_order` and `record_payment` can be proven early. This is the "early design spike" mitigation for R3. P1 adds the remaining functions and all the screens.
8. Latest stable versions at P0 start, pinned in the lockfile: React 19, Vite, React Router 7, Tailwind CSS 4, shadcn/ui, TanStack Query 5, Node LTS, pnpm 10.

---

## 2. Phase 0 task order

Estimates are in developer-days (d). Total is about **10.5 d**, so about **1 calendar week with 2 developers** working in parallel lanes, which matches the spec.

| # | Task | Owner | Est. | Depends on |
|---|---|---|---|---|
| T1 | Accounts, access, repository | A+B | 0.5 d | approval, Q2 |
| T2 | Monorepo scaffold and code quality | B | 1 d | T1 |
| T3 | Supabase local stack and migration workflow | A | 0.5 d | T1 |
| T4 | Core schema (P1 tables, enums, settings) and seed | A | 1.5 d | T3 |
| T5 | Auth, roles and RLS baseline with test harness | A | 1.5 d | T4 |
| T6 | Proof functions `create_order` and `record_payment` with tests | A | 1.5 d | T5 |
| T7 | Design system foundation (tokens, theme, base components, i18n and RTL) | B | 2 d | T2 |
| T8 | Staff app shell: login, role routing, layouts, offline banner, PWA | B | 1.5 d | T5, T7 |
| T9 | CI pipeline (quality gate, DB tests, type drift, bundle budget) | A | 0.5 d | T2, T3 |
| T10 | CD: Vercel apps, DB migrations to staging and production, staging users | A+B | 0.5 d | T8, T9 |
| T11 | Observability, README, PR template, P0 demo and sign-off | A+B | 0.5 d | all |

### T1. Accounts, access and repository (0.5 d)
- Create the GitHub repo, the `main` and `develop` branches, and branch protection (PR required, CI green, 1 review, no force push).
- Supabase staging: the existing project `restaurant management system` (ref `aqxmdmkforcucmktwmjj`, `ap-southeast-1` Singapore). Enable Auth email provider, disable public sign-ups, enable TOTP MFA. Production (`rms-prod`, same region and settings) is created in T10.
- The repo is **public**: GitHub secret scanning and push protection are enabled, and no secret, key, `.env` file or private owner or business data is ever committed.
- Create the Vercel team and Sentry org. Set up a password manager vault for shared secrets.
- **AC:** both developers can open all four services. No secret sits in any chat or file in Git. The project refs are recorded in the README.

### T2. Monorepo scaffold (1 d)
- pnpm workspaces and Turborepo. Shared `tsconfig` (strict, `noUncheckedIndexedAccess`). ESLint (typescript-eslint, react-hooks, jsx-a11y, import order). Prettier with the Tailwind plugin. EditorConfig. `.nvmrc`.
- Workspaces: `apps/staff-app`, `apps/customer-web`, `packages/ui`, `packages/shared`, `packages/config`.
- Root scripts as listed in CLAUDE.md.
- **AC:** `pnpm install && pnpm lint && pnpm typecheck && pnpm build` passes from a clean clone on Windows and macOS or Linux. `pnpm dev` serves both apps.

### T3. Supabase local and migration workflow (0.5 d)
- Run `supabase init` and pin the CLI version in `package.json` devDependencies (`supabase` npm package).
- Write the workflow into the README: `pnpm db:new <name>`, then write the SQL, then `pnpm db:reset`, `pnpm db:test` and `pnpm db:types`, then commit migration, tests and types together.
- Rules: one concern per migration, never edit an applied migration, and use `supabase db diff` only as a helper (the SQL is always reviewed by hand).
- **AC:** `supabase start` followed by `pnpm db:reset` works on both machines. An empty test suite runs.

### T4. Core schema and seed (1.5 d)
Migrations, in order:
1. `extensions`: pgcrypto, pg_cron (used in P2), pgTAP (tests).
2. `enums`: `app_role`, `order_type`, `order_source`, `order_status`, `batch_status`, `payment_status`, `payment_method`, `table_status`.
3. `branches` (one default row), and `settings` (single row, keyed by branch). Money and percentage columns are integers; it also holds `timezone`, `day_cutoff_time`, `kitchen_warn_min` and `kitchen_late_min`.
4. `profiles`, `categories`, `menu_items`, `restaurant_tables`.
5. `orders`, `order_batches`, `order_items`, `order_status_history`, `payments`, `order_counters`, `audit_log`.
6. Common triggers (`updated_at`), constraints (`CHECK amount > 0`, `quantity BETWEEN 1 AND 99`) and indexes. Includes the partial unique index `orders(table_id) WHERE status NOT IN ('completed','cancelled')` (BR-05) and the unique index `orders(request_id)` (BR-15).
7. Helpers: `business_date(ts)` (time zone and cut-off), `next_order_number(business_date)` (atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`), and `calc_order_totals(order_id)`.

`seed.sql` (local only): Demo Restaurant settings, 6 categories, about 30 items (including bottled drinks with `needs_kitchen = false`, and some with photos from `supabase/seed/images`), 12 tables in 2 sections (Hall, Family), and 6 users (`admin`, `cashier`, `waiter1`, `waiter2`, `chef`, `rider`) with local-only passwords.

- **AC:** `pnpm db:reset` builds everything with no errors. `pnpm db:types` generates types with no `any`. The ERD is exported to `docs/erd.md` (Mermaid).
- **As built (T4):**
  - Split into 13 migrations, one concern each. Constraints and indexes sit with their table, not in a separate step 6.
  - pgTAP is created by each test (test-only, never installed in staging or production). pg_cron is deferred to P2, together with the P2 settings columns (online ordering, busy mode, auto-accept).
  - Added `private.round_to_unit` and `compute_order_totals`, plus the payment void schema.

### T5. Auth, roles and RLS baseline (1.5 d)
- `profiles.role` is the **source of truth**. `public.app_role()` and `public.is_active_staff()` are `STABLE SECURITY DEFINER` helpers that read `profiles` by `auth.uid()`. Policies use `(select public.app_role())` so it is evaluated once per statement. This makes deactivation take effect at once, instead of waiting for the JWT to refresh.
- A Custom Access Token Hook copies `role` into the JWT. The **UI uses it only for routing**, never for security.
- Baseline:
  - RLS is enabled on every table.
  - `anon` has no access to anything in P0.
  - `authenticated` gets SELECT policies per role (see the matrix below) and **no INSERT, UPDATE or DELETE policies** on business tables. Writes happen only through functions.
  - `REVOKE EXECUTE ON ALL FUNCTIONS … FROM public, anon`, then a targeted `GRANT` for each RPC.
- SELECT matrix in P0 (extended in P1):

  | Table | Admin | Cashier | Waiter | Chef | Rider |
  |---|---|---|---|---|---|
  | settings | all | all | non-money | none (via RPC) | none |
  | categories, menu_items | all | all | active (no `cost_price`, via view) | via RPC | none |
  | restaurant_tables | all | all | all | none | none |
  | orders, order_items, order_batches | all | all | own orders (`waiter_id`) | **none** (via `get_kitchen_queue`) | none (P3) |
  | payments | all | all | none | none | none |
  | audit_log | all | none | none | none | none |
  | profiles | all | self + names | self + names | self | self |

  `cost_price` and `cost_snapshot` are hidden from everyone but Admin, through views or RPCs (same column problem as G6).
- Test harness in `supabase/tests/000_helpers.sql`: `tests.login_as(role)` sets `request.jwt.claims` and `role authenticated`. Every test file runs inside `BEGIN … ROLLBACK`.
- **Guard tests:**
  - (a) Fail if any table in `public` has RLS disabled.
  - (b) Fail if any `SECURITY DEFINER` function has no fixed `search_path`.
  - (c) Fail if `anon` can execute any function.
  - (d) A per-role SELECT test for every row of the matrix.
- **AC:** all guard tests pass. A deactivated user's next request is denied. Creating a new table without RLS makes CI red (demonstrated once on a branch).

### T6. Early proof: `create_order` and `record_payment` (1.5 d)
Both are `SECURITY DEFINER`, `set search_path = ''`, check the role first, run in one transaction, raise stable error codes, and are idempotent by `request_id`.

```
create_order(request_id uuid, type order_type, table_id uuid null,
             customer_name text null, customer_phone text null,
             items jsonb)   -- [{menu_item_id, quantity, notes}] — no prices accepted
  → { order_id, order_number, status, totals }

record_payment(request_id uuid, order_id uuid,
               tenders jsonb) -- [{method: 'cash'|'card', amount, tendered?, reference?}]
  → { order_id, payment_status, status, change_due }
```

`create_order` does the following in one transaction:
1. Checks the role (Dine-In: Admin, Cashier or Waiter; Take Away: Admin or Cashier).
2. Validates the items: they must exist and be active and available, with quantity 1 to 99.
3. Locks the table and checks BR-05.
4. Takes the business date and order number.
5. Inserts the order, batch 1 and the item snapshots.
6. Calculates the totals.
7. Sets the table to Occupied.
8. Writes the status history.
9. If the order has no kitchen items, it moves to Ready automatically (BR-08).

`record_payment` does the following in one transaction:
1. Checks the role (Admin or Cashier).
2. Locks the order and checks that it is not cancelled or already paid.
3. Checks that the sum of tenders equals `total`.
4. Inserts the payments and sets the order to Paid.
5. If the order is fulfilled, it moves to Completed and the table to Available.
6. Writes the history.

**pgTAP test cases (about 30):**

| Area | Cases |
|---|---|
| Totals | Totals equal a hand-calculated fixture (tax and service charge, rounding edge at .5). Client-supplied `price` key is rejected. Snapshot keeps the old price after the menu price changes (BR-02). Service charge is not applied to Take Away. |
| Numbering | First order of the day is `ORD-YYYYMMDD-001`, and the second is `-002`. An order at 02:00 belongs to the previous business date (BR-04). The counter restarts on the next business day (BR-03). |
| Idempotency | Same `request_id` twice gives the same order and one row (BR-15). The same holds for payment. |
| Rules | Second open order on a table gives `TABLE_HAS_OPEN_ORDER`. Sold-out or archived item gives `ITEM_UNAVAILABLE`. Quantity 0 or 100 is rejected. Drinks-only order is Ready immediately with no kitchen batch visible (BR-07, BR-08). Table becomes Occupied. |
| Permissions | Chef, rider and anon cannot call `create_order`. Waiter cannot create Take Away. Waiter, chef and rider cannot call `record_payment` (BR-11). |
| Payment | Exact cash gives Paid and Completed (if fulfilled), and the table becomes Available. Cash and card split gives 2 rows. Sum not equal to total gives `PAYMENT_MISMATCH` and **nothing is written**. Tendered below the cash amount is rejected, and change is returned. Paying a cancelled or already paid order is rejected. Paid but not yet served stays open, with the table still Occupied (BR-12). |
| Concurrency | Two sessions creating orders on the same table: one succeeds (smoke test via `dblink` or a scripted Vitest against local). |

- **AC:** all cases pass in CI. A short ADR, `docs/adr/001-business-logic-in-postgres.md`, records the pattern so that every P1 function copies it.

### T7. Design system foundation (2 d)
- `packages/ui`: `tokens.css` (CSS variables, light and dark, brand placeholder), Tailwind v4 `@theme` mapping, fonts (self-hosted via Fontsource), and `cn()` helper.
- shadcn/ui base components, listed in 4.4, themed to the tokens.
- Domain primitives: `MoneyText`, `StatusBadge`, `QtyStepper`, `StickyActionBar`, `OfflineBanner`, `ConnectionDot`, `EmptyState`, `ErrorState`, `Skeleton` presets.
- i18n: react-i18next with namespaces, `en` complete and an `ur` stub. `dir` is set on `<html>`. An ESLint rule (`i18next/no-literal-string`) blocks literal JSX strings in apps.
- A `/dev/ui` gallery route (dev builds only) showing every component in light, dark, LTR and RTL.
- Brand files: make `packages/ui` the single source for `logo.svg` and `logo-mark.svg`, and copy them into each app's `public/brand/` at build time. Until then the two app copies are kept in sync by hand (decision of 24 Oct 2026).
- **AC:** the gallery renders in all 4 combinations. An axe check on the gallery reports 0 serious violations. Changing `--brand` in one place re-themes the whole app.

### T8. Staff app shell (1.5 d)
- Vite, React Router with lazy role routes (`/waiter`, `/kitchen`, `/cashier`, `/admin`; `/rider` is P3). Providers: Supabase client, TanStack Query, i18n, theme.
- Login (username and password; MFA prompt wired for Admin). After login the user is redirected to their role's home, and a route guard sends wrong-role access back to their own home.
- The 4 role layouts (empty content): bottom nav, kitchen full-screen, cashier split, admin sidebar.
- Realtime: connect to a private broadcast channel and show `ConnectionDot` status. An `OfflineBanner` appears from `navigator.onLine` plus the channel state, and disables primary actions while offline.
- PWA: manifest, icons (placeholder logo), asset precache, and an "update available" toast.
- **AC:** each of the 5 seeded users logs in on staging and lands on the correct screen (the P0 done criterion). Wrong-role URLs redirect. Airplane mode shows the banner within 2 s. Lighthouse PWA installable check passes.

### T9. CI pipeline (0.5 d)
`ci.yml` runs on every push and PR:
1. Install with cache.
2. Lint, typecheck, unit tests (Vitest).
3. `supabase start` (database only), `supabase db reset`, `supabase test db`.
4. Type drift: regenerate the types and `git diff --exit-code`.
5. Build.
6. Bundle budget with `size-limit`: customer-web ≤ 200 KB gzip initial JS, staff-app limits from 4.10.
7. Upload the Playwright smoke results (login per role against local).
- **AC:** a PR with a lint error, a failing pgTAP test, stale types or an oversized bundle is blocked. Run time is under 10 minutes.

### T10. CD (0.5 d)
- Vercel: 2 projects (`rms-staff`, `rms-web`). Production branch is `main`, and `develop` gets a fixed staging domain. Each PR gets a preview, which uses the **staging** backend.
- `db-deploy.yml`: on push to `develop`, `supabase db push` to staging; on push to `main`, the same to production behind the GitHub Environment `production` with required reviewer approval. Secrets (`SUPABASE_ACCESS_TOKEN`, DB passwords, project refs) live only in GitHub Environments.
- Staging users and demo data are loaded by `scripts/seed-staging.ts`, run by hand with the service-role key from the vault. `seed.sql` never runs on cloud projects, and production gets no demo data.
- **AC:** merging to `develop` deploys both apps and the migrations to staging. Merging to `main` deploys to production after approval. Rollback means redeploying the previous Vercel build plus a forward-fix migration, documented in the README.

### T11. Observability, docs and sign-off (0.5 d)
- Sentry in both apps (release equals the commit SHA, source maps uploaded in CI, PII scrubbing). An uptime monitor on both domains and the Supabase health endpoint.
- README (setup, commands, workflow), `.github/PULL_REQUEST_TEMPLATE.md` (checklist: migration? RLS and tests? i18n? screenshots in light and dark?), CODEOWNERS (`supabase/**` needs the backend lead).
- **P0 exit demo:**
  - Log in as each role on staging.
  - Show CI going red and then green.
  - Run `create_order` and `record_payment` via the SQL tests.
  - Show the UI gallery.

### Phase 0 done when (spec 11, plus this plan)
- [ ] A user logs in on staging and lands on their role's screen (all 5 roles)
- [ ] CI runs lint, type check, unit, pgTAP, type drift and bundle budget on every push
- [ ] Staging (`develop`) and production (`main`) both deploy apps and migrations from Git
- [ ] RLS is on every table, guard tests are green, and `create_order` and `record_payment` are proven by tests
- [ ] Design tokens, base components and i18n and RTL scaffolding are in the UI gallery

---

## 3. Repository, environments, CI/CD and Git

### 3.1 Folder structure
```text
restaurant-system/
├─ apps/
│  ├─ staff-app/                 PWA: waiter, kitchen, cashier, admin (rider P3)
│  │  └─ src/
│  │     ├─ app/                 router.tsx, providers, role layouts, route guards
│  │     ├─ features/            one folder per feature, each with components/, hooks/ (queries, mutations), api.ts
│  │     │  ├─ auth/  tables/  order-entry/  kitchen/  cashier/  reports/
│  │     │  └─ admin/ (menu/ tables/ staff/ settings/)
│  │     ├─ lib/                 supabase.ts, query-client.ts, realtime.ts, sound.ts, wake-lock.ts
│  │     ├─ i18n/                index.ts, locales/en/*.json, locales/ur/*.json
│  │     └─ main.tsx
│  └─ customer-web/              P0 placeholder; P2 website (same internal layout)
├─ packages/
│  ├─ ui/                        tokens.css, theme, shadcn components, domain primitives, gallery stories
│  ├─ shared/                    database.types.ts (generated), zod/, money.ts, status.ts (transitions), errors.ts
│  └─ config/                    eslint, tsconfig, tailwind and prettier presets
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                YYYYMMDDHHMMSS_<name>.sql
│  ├─ tests/                     000_helpers.sql, 010_rls_guards.test.sql, 100_create_order.test.sql, …
│  ├─ functions/                 Edge Functions: staff-admin (P1), place-order (P2)
│  ├─ seed.sql                   local-only demo data
│  └─ seed/images/
├─ scripts/                      seed-staging.ts, check-env.ts
├─ e2e/                          Playwright specs
├─ docs/                         spec.md, plan-phase0.md, adr/, erd.md, guides/ (per-role user guides, P1)
├─ .github/                      workflows/ci.yml, workflows/db-deploy.yml, PULL_REQUEST_TEMPLATE.md, CODEOWNERS
└─ CLAUDE.md, README.md, .env.example, turbo.json, pnpm-workspace.yaml
```

### 3.2 Environments
| | Local | Staging | Production |
|---|---|---|---|
| Backend | `supabase start` (Docker) | Supabase project `restaurant management system`, `ap-southeast-1` (Free until UAT) | `rms-prod`, `ap-southeast-1`, created in T10 (**Pro before go-live**) |
| Front ends | Vite dev servers | Vercel, `develop` branch, plus PR previews | Vercel `main` (**Pro before go-live**, D14) |
| Data | `seed.sql` | `seed-staging.ts` demo data and UAT real menu | Real data only |
| Migrations | `db reset` | Auto on merge to `develop` | On merge to `main` + manual approval |
| Env vars | `.env.local` | Vercel and GitHub Environment `staging` | Vercel and GitHub Environment `production` |

Front-end env vars are only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design, and safe because of RLS) and `VITE_SENTRY_DSN`. `scripts/check-env.ts` fails the build if a variable named `*SERVICE_ROLE*` is visible to Vite.

The Free plan pauses after 7 days of inactivity (R2). The staging project gets a weekly CI keep-alive ping until it moves to Pro.

### 3.3 Git workflow
- `main` is production, `develop` is staging, and work happens on `feat/<id>-short-name` or `fix/…` branches cut from `develop`.
- Every change goes through a PR into `develop` and is squash-merged. A release is a PR from `develop` into `main` (merge commit) with a tag `vX.Y.Z`.
- Conventional Commits. Hotfixes branch from `main` and are merged back into both branches.
- A PR that touches `supabase/migrations` needs the backend lead's review (CODEOWNERS), and the migration, its tests and the regenerated types come in the same PR.

---

## 4. UI/UX design system

No frontend design skill is available in this environment, so this section is written directly.

### 4.1 Visual direction: "Warm Modern"
The look is clean, warm and confident: warm stone neutrals instead of cold grey, one appetising ember brand colour used sparingly for primary actions, generous whitespace, rounded but not bubbly shapes, and large confident numerals. Staff screens are **calm and functional**: the colour on them comes from *status*, not decoration. The customer site is **photo-led**, with the food as the hero and the UI receding.

**Key rule:** brand colour never means status. Status always pairs colour with an icon and a label, because orange brand and amber warning are close in hue.

### 4.2 Colour tokens (semantic, CSS variables)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` *(placeholder)* | `#C2410C` ember | `#FB923C` | Primary CTA: Send to Kitchen, Pay, Checkout |
| `--brand-fg` | `#FFFFFF` | `#1C1917` | Text on brand (light 5.2:1, dark 8:1) |
| `--accent` | `#F59E0B` saffron | `#FBBF24` | Highlights, cart count, deal ribbons (with dark text only) |
| `--bg` / `--surface` / `--surface-2` | `#FAFAF9` / `#FFFFFF` / `#F5F5F4` | `#0C0A09` / `#1C1917` / `#292524` | Page, cards, inset areas |
| `--text` / `--text-muted` | `#1C1917` / `#57534E` | `#FAFAF9` / `#A8A29E` | Body / secondary (both AA) |
| `--border` / `--ring` | `#E7E5E4` / `--brand` | `#44403C` / `--brand` | Dividers / focus ring |
| `--success` (+`-bg`) | `#15803D` / `#DCFCE7` | `#4ADE80` / `#052E16` | Available, Ready, Paid, kitchen "fresh" |
| `--warning` (+`-bg`) | `#B45309` / `#FEF3C7` | `#FBBF24` / `#451A03` | Bill requested, kitchen "aging" |
| `--danger` (+`-bg`) | `#B91C1C` / `#FEE2E2` | `#F87171` / `#450A0A` | Cancel, errors, kitchen "late" |
| `--info` (+`-bg`) | `#1D4ED8` / `#DBEAFE` | `#60A5FA` / `#172554` | Occupied, Preparing, notices |

Neutrals follow the Tailwind *stone* scale. The brand placeholder is set in one file, `packages/ui/src/brand.css` (`--brand`, `--brand-fg` and the logo path `/brand/logo.svg`). `brand-50…900` tints are derived with `color-mix()`, so swapping in the client's colour is a single change. A CI contrast script checks `--brand` against `--brand-fg` at 4.5:1 or better.

**Table status:** Available is success (green). Occupied is info (blue). Bill Requested is warning (amber, with a receipt icon). Reserved (P3) is neutral outline with a clock icon.

**Kitchen age:** green under `warn_min`, amber from `warn_min` to `late_min`, red with a slow pulse at `late_min` and above.

### 4.3 Typography, spacing, radius, shadows, motion
- **Fonts:**
  - **Inter** (variable, self-hosted, Latin subset, `font-feature-settings: "tnum"` for money and timers) is used everywhere.
  - **Fraunces** (display serif, 2 weights) is used only for customer-site headings, for warmth.
  - **Noto Nastaliq Urdu** loads only when `lang=ur`, with a larger line-height token.
- **Type scale** (rem, base 16): 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48. Kitchen uses a **display density**: a 1.25× multiplier (base 20, item names 24 to 28, table number 36 to 48).
- **Spacing:** 4 px grid (`1 = 4px`), with layout gaps of 16, 24 and 32.
- **Density modes** via `data-density`: `touch` (waiter and customer: 48 px controls), `display` (kitchen: 56 px), `desk` (admin: 40 px, 44 px on touch devices).
- **Radius:** `sm 6` · `md 10` (inputs, buttons) · `lg 14` (cards) · `xl 20` (sheets, dialogs) · `full` (chips, avatars).
- **Shadows** (warm-tinted, low): `sm` for cards, `md` for popovers and the sticky bar, `lg` for dialogs. Dark mode uses lighter surfaces instead of shadows.
- **Icons:** lucide-react, 20 px (24 px touch, 28 px kitchen), stroke 2, always with a text label in nav and actions.
- **Motion:**
  - 120 ms for feedback (press, toggle), 200 ms for enter and exit (sheet, toast), 300 ms at most for layout. `ease-out` to enter, `ease-in` to exit.
  - New kitchen ticket: one 200 ms slide and highlight. No bouncing, parallax or looping animation, except the late-ticket pulse, which becomes a static thick border under `prefers-reduced-motion`.
  - `prefers-reduced-motion` turns off transforms and keeps opacity changes only.

### 4.4 Components (Tailwind + shadcn/ui in `packages/ui`)
- **shadcn base:** Button (variants primary, secondary, ghost, outline, destructive; sizes sm, md, lg, xl; loading state), Input, Textarea, Select, Combobox, Checkbox, Switch, RadioGroup, Label, Form (RHF and Zod wiring), Card, Dialog, AlertDialog, Sheet (bottom sheet on mobile), Drawer, Popover, Tooltip, DropdownMenu, Tabs, Badge, Table, Toast (Sonner), Skeleton, Separator, ScrollArea, Avatar, Command (search palette).
- **Patterns:** DataTable (TanStack Table: sort, filter, paging, column visibility, empty and loading rows), PageHeader, KpiCard, ChartCard (lazy Recharts), FormSection, ConfirmDialog (destructive only), **ReasonDialog** (required reason for cancel and discount), EmptyState (icon, one line, one action), ErrorState (what happened, what to do, Retry), OfflineBanner, ConnectionDot, BottomNav, Sidebar, StickyActionBar, SearchField (instant, debounced at 100 ms, locally filtered).
- **Domain:** TableTile, MenuItemCard (compact for staff, photo for customer), QtyStepper, CartLine, OrderSummary, StatusBadge, KitchenTicket (with AgeTimer and an ADD-ON ribbon), BillListItem, PaymentPad (tenders, numeric keypad, quick-cash buttons, change), ReceiptPreview (80 mm print CSS), MoneyText (integer to formatted currency, in one place).

### 4.5 Layout patterns and breakpoints
Breakpoints are Tailwind defaults: `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`.

| Role | Device | Layout |
|---|---|---|
| Waiter | Phone (portrait), tablet | Bottom nav (Tables, Orders, Alerts). Order entry: category chips, then item list, then **StickyActionBar** (count, total, Send). Tablet: menu and cart side by side from `md`. |
| Chef | Kitchen tablet or TV, landscape | Full-screen, no nav chrome. Top bar (clock, connection, Sold Out list, sound on or off). Ticket columns in a CSS grid: 2 at `md`, 3 at `lg`, 4 to 5 at `xl` and up. Dark theme by default. |
| Cashier | Counter PC or tablet, landscape | **Split screen**: left 38% open bills (Bill Requested first, then Ready take away, then the rest), right 62% bill detail and payment. Under `lg` it becomes list then detail with a back button. |
| Admin | Laptop and phone | Collapsible sidebar (icon rail at `md`, full at `lg`), top bar, content max 1280 px. Phone: sidebar in a Sheet, tables become cards. |
| Customer (P2) | Phone first | Header, sticky category bar (scroll-spy), photo menu cards, floating cart button, then a cart sheet and 3-step checkout. Desktop: 3-column menu and a sticky cart sidebar. |
| Rider (P3) | Phone | Single list of assigned deliveries, large cards, 2 big buttons per state, tap-to-call (`tel:`), and an open-in-maps link. |

### 4.6 UX rules
1. **Feedback within 100 ms** for every tap (pressed state, then button spinner). Never freeze the whole screen.
2. **Optimism policy (G1):** local state is optimistic. Server state (status, payment, sold out) shows *pending*, then confirmed, or rolls back with a toast. Mutations get a `request_id` when the action starts, so retries are safe.
3. **Skeletons, not spinners**, for page loads, shaped like the real content. Spinners appear only inside buttons.
4. **Errors in plain words:** what happened and what to do, for example "Table 7 already has an open bill. Open it instead?". Each RPC error code maps to one i18n message, and raw technical text never reaches staff.
5. **Confirm only destructive or irreversible actions** (cancel item or order, discount, archive, sign out other device). Cancel and discount use ReasonDialog. Everything else is undoable or harmless.
6. **Alerts:**
   - A "Start shift" tap unlocks audio and requests the Wake Lock (R10).
   - New kitchen ticket: chime. Ready for the waiter: a distinct tone, `navigator.vibrate` (Android only, since iOS has no vibration API) and a banner. New bill request for the cashier: soft tone.
   - Sound can be muted per device, but mute state is clearly visible.
7. **Realtime:** events only invalidate queries, and every reconnect refetches everything visible. The ConnectionDot is always visible to staff.
8. **Offline:** a red banner says "Offline: orders can't be sent. Keep this screen open; it will reconnect." Primary actions are disabled, and the cart is kept.
9. **Speed paths:** at most 3 taps per core task. Tables, then tap a table (opens order entry), then tap items, then Send. The search field is focused by one tap and filters instantly, offline-capable from the cached menu.
10. **i18n and RTL:** no literal strings, ICU plurals, logical properties only, directional icons flip with `rtl:-scale-x-100`, numbers stay in Latin digits, and currency and dates are formatted with `Intl`. All locale files are lazy-loaded.

### 4.7 Accessibility (WCAG 2.2 AA)
- Contrast is 4.5:1 for text and 3:1 for UI and focus indicators, verified for both themes by the CI contrast script and axe.
- A visible focus ring (2 px `--ring` plus 2 px offset) on every interactive element. Full keyboard path on cashier and admin screens.
- Every input has a `<label>`. Errors are linked with `aria-describedby`. Icon-only buttons have `aria-label`.
- Status is never colour alone (icon plus text). New orders and alerts are announced through an `aria-live="polite"` region, and payment errors through `assertive`.
- Touch targets are at least 44×44 px (48 px default on touch), with 8 px or more between targets.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`. Text resizes to 200% without loss.
- Playwright runs axe on every main screen in CI from P1 on.

### 4.8 Cashier keyboard shortcuts
| Key | Action |
|---|---|
| `/` | Search bills |
| `↑` `↓` `Enter` | Move through and open bills |
| `N` | New counter order |
| `P` | Pay the selected bill |
| `1` | Cash full amount |
| `2` | Card full amount |
| `S` | Split |
| `Ctrl+P` | Print the receipt |
| `Esc` | Close or back |
| `?` | Show the shortcut sheet |

Shortcuts are shown as hints on the buttons.

### 4.9 Role-specific notes
- **Waiter:** the table grid is sorted by section and number. Each tile shows the number, the status colour and icon, the guest count and the order age. The "My tables" filter is on by default. A Ready alert badge appears on the Orders tab.
- **Chef:** no prices anywhere (G6). One card per **batch**. ADD-ON batches carry a ribbon and the parent order number. Bump buttons are 56 px or larger: Start, then Ready. A "Sold Out" sheet lets the chef search and toggle items. The screen is readable from 3 m (table number 48 px, item names 24 px or larger, notes highlighted).
- **Cashier:** bill detail shows the lines, then the totals block, then payment. Quick-cash buttons are Exact, next round 500, and next round 1000. Change due is shown large. A receipt preview appears before printing, and printing runs automatically after payment when enabled.
- **Admin:** dashboard KPIs are Today's sales, Orders, Average order value, and Open bills. Charts show sales by hour and by order type, plus the top 10 items. Forms are single-column with sections and a sticky Save bar.
- **Customer (P2):** design tokens are shared, but the bundle is separate. Photos are AVIF or WebP, responsive (`srcset`) and lazy below the fold. The name, phone and address are remembered on the device.

### 4.10 Performance budget
| Target | Budget (enforced in CI) |
|---|---|
| customer-web initial JS (gzip) | **≤ 200 KB** (target 150), with LCP image preloaded and Lighthouse mobile ≥ 90 |
| staff-app shell and login (gzip) | ≤ 180 KB |
| Each role chunk (waiter, kitchen, cashier) | ≤ 120 KB. Admin ≤ 250 KB including Recharts, which is never loaded outside admin |
| Fonts | ≤ 2 files on first paint, `font-display: swap`, preloaded |
| Interaction | Tap feedback under 100 ms. Order on kitchen screen under 2 s (spec). |

### 4.11 Text wireframes (Phase 1 key screens)

**Waiter, Tables (phone):**
```
┌──────────────────────────────┐
│ Tables        ● Live   [Mine]│
│ Hall                         │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│ │ 1  │ │ 2  │ │ 3  │ │ 4  │  │
│ │ ✓  │ │●12m│ │🧾  │ │ ✓  │  │  ✓ green Available · ● blue Occupied
│ └────┘ └────┘ └────┘ └────┘  │  🧾 amber Bill requested
│ Family                       │
│ ┌────┐ ┌────┐ ┌────┐         │
│ │ 9  │ │ 10 │ │ 11 │         │
├──────────────────────────────┤
│  ▦ Tables   ☰ Orders(2)  🔔  │  bottom nav, 56px
└──────────────────────────────┘
```

**Waiter, Order screen (phone, table 7):**
```
┌──────────────────────────────┐
│ ← Table 7 · 4 guests   ● Live│
│ [🔍 Search menu…           ] │
│ (All)(Starters)(BBQ)(Karahi)(Drinks) ← sticky, scroll-x
│ ─────────────────────────────│
│ Chicken Tikka        [−] 2 [+]│  48px rows; tap row = +1
│ Seekh Kebab              [ + ]│
│ Mutton Karahi (half)     [ + ]│
│ Mint Margarita           [ + ]│
│ Sold out · Fish Tikka   (grey)│
│ ─────────────────────────────│
│ Sent: batch 1 · Preparing    │  (only when adding more)
├──────────────────────────────┤
│ 3 items · Rs 2,450           │
│ [ Review ▲ ]  [ SEND TO KITCHEN ]│ sticky bar, brand colour
└──────────────────────────────┘
Review ▲ opens a bottom sheet: lines, qty, notes ("no onion"), remove.
```

**Kitchen screen (landscape, dark):**
```
┌────────────────────────────────────────────────────────────────┐
│ KITCHEN   21:42   ● Live   🔊 On   [Sold out]          6 open   │
├───────────────┬───────────────┬───────────────┬────────────────┤
│▌T7 · DINE-IN  │▌T3 · ADD-ON   │▌TAKE AWAY     │▌T12 · DINE-IN  │
│ 02:10  green  │ 11:30  amber  │ 22:05  RED    │ 00:40  green   │
│ 2 Chicken Tikka│ 1 Naan       │ 3 Zinger      │ 1 Karahi half  │
│ 1 Seekh Kebab │   "extra crisp"│ 2 Fries      │   "less spicy" │
│               │ ORD-…-014     │ Ali · 0300…   │                │
│ [  START  ]   │ [  READY  ]   │ [  READY  ]   │ [  START  ]    │
└───────────────┴───────────────┴───────────────┴────────────────┘
Oldest first; age bar colour on the left edge + text label; no prices.
```

**Cashier, bill and payment (counter, landscape):**
```
┌──────────────────────┬─────────────────────────────────────────┐
│ Open bills  [/] [N]  │ Table 3 · ORD-20261024-014 · Ahmed (W)  │
│ 🧾 T3   Rs 3,980  ◀  │ 2  Chicken Tikka        1,200           │
│ 🧾 T9   Rs 1,150     │ 1  Naan (ADD-ON)          100           │
│ ✓ TA-016 Ready 820   │ 1  Mint Margarita         450           │
│ ● T7   Rs 2,450      │ ─────────────────────────────────       │
│ ● T12  Rs   900      │ Subtotal 3,500 · Service 5% 175         │
│                      │ Tax 16% 560 · Discount −0               │
│                      │ TOTAL                  Rs 4,235         │
│                      │ ┌ Payment ───────────────────────────┐  │
│                      │ │ [Cash 1] [Card 2] [Split S]        │  │
│                      │ │ Received [ 5,000 ] [Exact][4.5k][5k]│ │
│                      │ │ Change due      Rs 765             │  │
│                      │ └────────────────────────────────────┘  │
│                      │ [Preview receipt]   [ PAY & PRINT (P) ] │
└──────────────────────┴─────────────────────────────────────────┘
```

**Admin dashboard (laptop):**
```
┌────────┬───────────────────────────────────────────────────────┐
│ LOGO   │ Dashboard            Business day: 24 Oct  [Today ▾]  │
│ ▦ Dash │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐      │
│ 🍽 Menu │ │Sales     ││Orders    ││Avg order ││Open bills│      │
│ ▢ Tables│ │Rs 84,300 ││  62      ││ Rs 1,360 ││   5      │      │
│ 👥 Staff│ │▲ 12% vs… ││▲ 4       ││▼ 2%      ││          │      │
│ 📊 Report│ └──────────┘└──────────┘└──────────┘└──────────┘     │
│ ⚙ Settings│ ┌ Sales by hour ─────────────┐┌ By type ─────────┐  │
│        │ │ ▁▂▅▇▆▃▂▄▇█▅                │ │ Dine-in 71%      │  │
│        │ └────────────────────────────┘ │ Take away 29%    │  │
│        │ ┌ Top items ──────────────────────────────────────┐   │
│        │ │ #  Item            Qty   Sales   [filter ▾]     │   │
│        │ │ 1  Chicken Tikka   48    28,800                 │   │
└────────┴───────────────────────────────────────────────────────┘
```

---

## 5. Phase 1 (MVP) outline: 4 to 5 weeks, modules M1 to M10

| Week | Backend (A) | Frontend (B) |
|---|---|---|
| 1 | `add_items_to_order`, `set_batch_status`, `set_order_status`, `remove_or_cancel_item`, `request_bill`, `apply_discount`, `set_item_availability`, `move_order_table`. Audit triggers (BR-24). Realtime broadcast triggers and `realtime.messages` RLS per topic. Full permission-matrix tests. | Admin: menu and categories (image upload to Storage), tables, settings. |
| 2 | `staff-admin` Edge Function (create, deactivate and reset staff; service role). MFA enforcement (`aal2`) for admin writes. `get_kitchen_queue`, open-bills and report RPCs. | Admin: staff and the daily report (M9). Waiter: tables and order entry. |
| 3 | Hardening: concurrency, idempotency and reconnect resync tests. | Waiter: add more, Ready alerts, served, request bill. Kitchen screen and Sold Out. |
| 4 | 50-order simulated-day script with total reconciliation. Smoke load test (50 screens, 200 orders an hour). | Cashier: open bills, counter take away, payment, receipt (80 mm). Axe and E2E. |
| 5 | Production setup (Pro plans, backups and a tested restore). | Per-role one-page guides, UAT on staging, fixes, go-live checklist (spec 12). |

The exit gate is the 10 P1 done criteria in spec section 11. Each one maps to a Playwright or pgTAP test, or a written UAT step.

---

## 6. Risks (beyond spec section 13)

| Risk | Mitigation |
|---|---|
| Hidden-column leaks: cost price or prices reach chefs or waiters through a table SELECT or a realtime payload | Views and RPCs for restricted columns, ID-only broadcasts, and a column-exposure test per role |
| `SECURITY DEFINER` misuse (search_path, missing role check) | Guard tests (T5). Every function starts with `perform private.require_role(...)`. Backend-lead review via CODEOWNERS. |
| iOS PWA limits: no vibration, audio needs a gesture, timers throttled in the background | "Start shift" unlock, Wake Lock, an alert banner on return, and Android tablets recommended for kitchen and waiter |
| Time zone and business-day bugs around midnight and the cut-off | Calculated in SQL only, with tests at 23:59, 00:01, 03:59 and 04:00 |
| Rounding disputes on receipts | One totals function, a documented formula, an owner sign-off on 5 sample bills (Q1) |
| The design system grows before features need it | P0 builds only the components the gallery lists. Others are added as P1 needs them. |
| Free-plan pause or limits during development | Keep-alive ping, and Pro before UAT with real data |
| Staging preview deployments run against migrations that are not merged yet | Previews are for UI review only. Migration PRs are tested locally and in CI, not on previews. |

---

## 7. Open questions (please answer before or during P0)

1. **Money and tax (D2, G7):** is the currency PKR? Are menu prices tax-inclusive or exclusive? What are the tax % and service-charge %, and does service charge apply to Take Away?
2. **Accounts and team (D11):** who owns the GitHub, Supabase, Vercel and Sentry accounts (the client or us)? Is the team 2 developers, and what are the start and target go-live dates?
3. **Staff login (G15):** do all staff have an email address, or should we use username and password? Should shared devices (kitchen, counter) use per-person accounts with "switch user", or one shared kitchen login?
4. **Tables (G4):** can any waiter take any free table, and who may hand a table over to another waiter?
5. **Take Away payment (G9):** do counter customers pay before the food is ready, after it, or either?
6. **Discounts (D4, G7):** fixed amount, percentage, or both? Admin only means a cashier must call the owner for every discount. Is that acceptable, or should there be a manager PIN?
7. **Brand (4.1):** what are the restaurant name, logo (SVG if possible) and brand colour? Is Urdu needed at launch or later?
8. **Corrections after payment (G8):** must P1 support voiding or refunding a recorded payment (Admin only, with a reason), or is that left for P4?

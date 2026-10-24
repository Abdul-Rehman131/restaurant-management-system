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
- **As built (T5):**
  - **5 migrations:** revoke default grants, auth helpers, access token hook, SELECT policies, role-scoped RPCs.
  - **Role helper:** the plan's `app_role()` / `is_active_staff()` became `public.my_role()`, which returns NULL for inactive staff (one helper instead of two), plus `private.require_role()`.
  - **Username login:** `public.staff_login_email()` maps `<username>` to `<username>@staff.invalid` (mirrored in `packages/shared`), and a trigger keeps each profile's username and login email in sync.
  - **Token hook:** also refuses tokens for inactive staff.
  - **Settings:** RPC only (`get_settings()`, fields per role). Admin reads costs and staff phones through `admin_*` RPCs.
  - **Probe tests:** the "new table without RLS fails" check is a pgTAP probe that runs on every test run, not a one-off branch demo. It is confirmed in CI at T9.
  - **Chef kitchen RPCs** (`get_kitchen_queue`, Sold Out list) are P1, as planned.
  - **Hook is on locally:** `supabase/config.toml` enables it (`[auth.hook.custom_access_token]`, `enabled = true`, `uri = "pg-functions://postgres/public/custom_access_token_hook"`), so every local sign-in and refresh goes through it.
    - **What the tests cover:** `026_access_token_hook.test.sql` calls the function directly (claim added, inactive or unknown staff refused, only `supabase_auth_admin` may execute it). That does **not** go through the Auth server.
    - **Checked by hand:** the Auth path was verified manually in T5 with real logins against the local stack (`app_role` present for all 6 demo roles, 403 for a deactivated user).
    - **Automated end-to-end coverage** (log in, then read `app_role` from the session) arrives with the Playwright login smoke test in T8/T9.
    - Staging and production enable the hook at T10 (setup checklist).

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
- Brand files: `packages/ui/brand/` is the single source for the logo, logo mark and icons. They are copied into each app's `public/brand/` (gitignored) when Vite starts (`packages/ui/vite-plugin.mjs`).
- **AC:** the gallery renders in all 4 combinations. An axe check on the gallery reports 0 serious violations. Changing `--brand` in one place re-themes the whole app.
- **As built (T7):**
  - **Components:** every 4.4 "shadcn base" component and every T7 domain primitive, in `packages/ui/src/components/` (one per file). Patterns and other domain components (DataTable, ReasonDialog, KitchenTicket, PaymentPad, ...) are P1, as planned.
  - **Tokens added for contrast:** `--input` (field borders, 3:1), `--accent-fg`, `--danger-fg`, `--surface-raised` (popovers; lighter surfaces in dark mode), `--overlay`. `--border` stays a soft divider only.
  - **Checks:** `pnpm test` runs the contrast check for both themes (66 pairs, reads `brand.css` and `tokens.css`). `pnpm size` checks the initial-JS budgets and fails if gallery code reaches a production bundle. `pnpm e2e` runs the gallery in light, dark, LTR and RTL on phone and desktop with axe, and opens every overlay (axe plus focus return).
  - **Overlays:** `UiProvider` makes the page behind an open Radix overlay `inert` while Radix hides it, because Radix sets `aria-hidden` but leaves the content focusable (axe `aria-hidden-focus`).
  - **Skeletons are static** (no pulse), following 4.3. Only the P1 late-ticket pulse will animate.
  - **Money:** `formatMoney` in `@rms/shared` formats integer minor units without floats, using `currency_code` and `currency_minor_units` from settings. `MoneyText` is always LTR, so amounts stay intact in RTL.
  - **i18n:** `setupI18n` in `@rms/ui/i18n` (English bundled, other languages lazy-loaded, `ui` namespace for the components). Zod messages are `ui:validation.*` keys. The literal-string ESLint rule exempts only `data-*`, `htmlFor` and `autoComplete`.
  - **Gallery:** the staff app's `main.tsx` mounts `/dev/ui` only when `import.meta.env.DEV`; it moves into the router in T8. Options also come from the URL: `?theme=dark&dir=rtl&density=desk`.

### T8. Staff app shell (1.5 d)
- Vite, React Router with lazy role routes (`/waiter`, `/kitchen`, `/cashier`, `/admin`; `/rider` is P3). Providers: Supabase client, TanStack Query, i18n, theme.
- Login (username and password; MFA prompt wired for Admin). After login the user is redirected to their role's home, and a route guard sends wrong-role access back to their own home.
- The 4 role layouts (empty content): bottom nav, kitchen full-screen, cashier split, admin sidebar.
- Realtime: connect to a private broadcast channel and show `ConnectionDot` status. An `OfflineBanner` appears from `navigator.onLine` plus the channel state, and disables primary actions while offline.
- PWA: manifest, icons (placeholder logo), asset precache, and an "update available" toast.
- **AC:** each of the 5 seeded users logs in on staging and lands on the correct screen (the P0 done criterion). Wrong-role URLs redirect. Airplane mode shows the banner within 2 s. Lighthouse PWA installable check passes.
- **As built (T8, local Supabase only):**
  - **Verified locally, not on staging** (as instructed; staging is wired at T10). The Playwright suite runs against `supabase start` with the seed logins. Rider screens are P3, so rider lands on a "no screens yet" page. The Lighthouse installable check is not automated yet (manifest, icons and service worker are in place); it moves to T9 CI.
  - **Routing:** the JWT `app_role` claim only picks the screen. Wrong-role URLs go to the user's own home; **Admin may open every role area** (spec 4: full access) but lands on `/admin`. The database still decides every permission with `my_role()`.
  - **Login:** username and password through `staffLoginEmail()`. Messages: wrong username or password, account not active (the token hook's 403), too many attempts, no connection. A session that ends without the user signing out (expired, revoked, signed out in another tab) shows "Your session ended".
  - **Account status:** a separate check calls `public.my_role()` on sign-in and when the screen regains focus; NULL (deactivated) signs the user out with "not active any more". It is not tied to `get_settings`, which serves admin, cashier, waiter and chef only: an early version treated the rider's NOT_AUTHORIZED settings answer as "deactivated" and signed riders out (fixed, with an e2e test that waits for the `my_role` answer).
  - **Admin MFA:** with a verified TOTP factor the code step is required (aal2). Without one, a minimal set-up (QR, key, first code) can be skipped for the tab. Enforcement (aal2 for admin writes) is P1.
  - **Settings:** `get_settings` is validated by a Zod (`zod/mini`) schema in `packages/shared`; contact and pricing groups are optional because they depend on the role.
  - **Realtime:** private `staff:heartbeat` channel; RLS on `realtime.messages` allows SELECT for any active staff member through `my_role()`, with no INSERT policy (17 pgTAP tests). The connection is Live when joined, Reconnecting on a drop, and offline (banner, primary actions disabled) when the browser is offline or the channel is lost for more than 5 s. A rejoin refetches all queries.
  - **PWA:** the service worker registers after the first screen; a new version waits for the "Update" toast (tested on a production preview: `pnpm --filter @rms/staff-app e2e:pwa`).
  - **Seed:** a deactivated demo login `former` exists for the denial test. The "deactivated while signed in" e2e test switches `waiter2` off and on again in the local DB through the CLI container (`supabase_db_rms`).
  - **Tests at the end of T8:** pgTAP 376 (17 new for Realtime), Vitest 12, contrast 66 pairs, Playwright 45 passed and 1 skipped (the deactivation test runs once, on desktop), plus `e2e:pwa` 1.
  - **Bundles (budgets unchanged), final gate:** login 166.0 KB, signed-in shell 177.9 KB (budget 180 each), role chunks 37.8 to 41.3 KB (120; admin 250), Realtime 16.0 KB loaded after first paint (30), customer-web 92.1 KB (200). The signed-in shell was 177.8 KB before the account-status check added about 0.1 KB. The first measurement was 227.6 KB. It was brought down by: a lean Supabase client (`auth-js` in the entry, `postgrest-js` with the signed-in shell, `realtime-js` after first paint; no Storage or Functions), `zod/mini`, `@rms/shared` marked side-effect free, the Toaster lazy, a plain login form (no form library), and one tooltip provider per tooltip (Floating UI left the first screen). The largest remaining parts of the login path are react-dom, auth-js, react-router and i18next.
  - **Headroom warning:** the signed-in shell has only about **2 KB** left (177.9 of 180). Anything P1 adds to every signed-in screen (providers, the header, shared hooks) must go into the role chunks, which have plenty of room, or be lazy-loaded. If P1 needs more, lazy-load in this order: (1) the not-found, not-available and route-error screens, which the router imports statically today; (2) TanStack Query's code in the entry that the login screen does not use, by moving the QueryClientProvider into the signed-in shell; (3) `tailwind-merge` (about 8 KB) only by an ADR, since every component's `cn()` relies on it. Measure each with `pnpm build && pnpm size`. Raising the 180 KB budget needs a written reason here.

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
- **As built (T9):** `.github/workflows/ci.yml`, described job by job in the README ("CI").
  - **No secrets anywhere.** Every database check runs against a local Supabase stack started in the runner: the database container only for pgTAP, lint and type drift; auth, REST and Realtime for e2e. Triggers are `push` and `pull_request` only (never `pull_request_target`), default `permissions: contents: read`, `persist-credentials: false` on every checkout, and the final `ci` job has no permissions at all.
  - **Jobs, in parallel:** `quality` (lint, typecheck, Prettier, Vitest, contrast), `database` (start, reset, pgTAP, `db lint`, type drift with `git diff --exit-code`), `build-and-size`, `e2e` (Playwright on phone and desktop, then the PWA update test; report and traces uploaded only on failure), `secrets` (gitleaks over the full history, pinned release with a SHA-256 check rather than a third-party action), and `ci`, which needs all of them and is the one required status check. Docs-only changes skip `database`, `build-and-size` and `e2e`; skipped jobs count as passed in `ci`.
  - **Supply chain:** third-party actions pinned to full commit SHAs with a version comment; Dependabot proposes weekly updates for actions and npm (7-day cooldown on npm).
  - **Bundle budgets:** still the existing `scripts/check-size.mjs` instead of `size-limit`. It already measures each path through the app from Vite's manifest, which `size-limit` cannot do without a config per chunk.
  - **Found by CI:** without `VITE_SUPABASE_*` values, `src/lib/env.ts` always throws and the bundler dropped the Supabase client, so the first CI run measured login at 141.7 KB instead of 166.0 KB. The staff-app build now fails without those values, and CI builds with non-secret placeholders. Vercel (T10) must set both, or the deploy fails at build time instead of shipping a dead app.
  - **Gates proven red** on throwaway branches (one defect each, deleted afterwards): a lint error, a failing pgTAP test, a migration without regenerated types, an oversized login bundle and a fake secret-like string.

### T10. CD (0.5 d)
- Vercel: 2 projects (`rms-staff`, `rms-web`). Production branch is `main`, and `develop` gets a fixed staging domain. Each PR gets a preview, which uses the **staging** backend.
- `db-deploy.yml`: on push to `develop`, `supabase db push` to staging; on push to `main`, the same to production behind the GitHub Environment `production` with required reviewer approval. Secrets (`SUPABASE_ACCESS_TOKEN`, DB passwords, project refs) live only in GitHub Environments.
- Staging users and demo data are loaded by `scripts/seed-staging.ts`, run by hand with the service-role key from the vault. `seed.sql` never runs on cloud projects, and production gets no demo data.
- **AC:** merging to `develop` deploys both apps and the migrations to staging. Merging to `main` deploys to production after approval. Rollback means redeploying the previous Vercel build plus a forward-fix migration, documented in the README.
- **As built (T10, staging only; production deferred):**
  - **Production is deferred.** There is no `rms-prod`, no production workflow, secret or deploy job. The "Before go-live" list in `docs/setup-checklist.md` covers the project, the `production` environment with a required reviewer, a db-deploy job for `main`, the front-end production settings and D14.
  - **Vercel:** two projects on a personal Hobby account (Git integration), staging only. Their Production branch is `develop`, so the staging domain follows `develop` and Instant Rollback works; PR previews use the same staging values. `apps/*/vercel.json`: SPA rewrite, immutable `/assets`, no-cache for the service worker and `index.html`, basic security headers, and `git.deploymentEnabled.main = false` until go-live. Hobby is non-commercial, so production moves to Vercel Pro or Cloudflare Pages (D14).
  - **`db-deploy.yml`:** push to `develop` only, `environment: staging` (deployment branch `develop`), secrets passed only to the CLI steps, never cancelled half-way. Steps: link, drift check (`scripts/check-migration-drift.mjs` on `supabase migration list --linked`: a remote-only or out-of-order migration fails), dry run, push, then every migration must be applied. No `--include-seed`.
  - **`scripts/seed-staging.ts`** (`pnpm seed:staging`): creates `admin`, `cashier`, `waiter`, `chef` with confirmed `@staff.invalid` logins through the Auth admin API, using the secret key from the owner's shell; passwords are generated and printed once. Hard-wired to the staging ref, so it cannot reach production. Existing accounts are skipped. Tested end to end on the local stack (`--local`), including a sign-in that gets the `app_role` claim.
  - **New migration `create_staff_profile`:** the profile half of creating staff, `SECURITY DEFINER`, EXECUTE for `service_role` only (15 pgTAP tests: every staff role and anon refused; idempotent; `USERNAME_TAKEN`, `PROFILE_EXISTS`, `PROFILE_EMAIL_MISMATCH`). Needed because the API roles cannot run the column default (`private.default_branch_id()`) or the login-email trigger; P1's Admin "create staff" Edge Function will use it too. Idempotent on the auth user id instead of a `request_id`, since it is server-only.
  - **Keep-alive:** weekly ping of the staging Auth health endpoint with no secrets (repository variables). Scheduled workflows run from `main` only, so the schedule starts when `develop` is next merged to `main`; until then the `db-deploy` runs on each push to `develop` also count as activity.
  - **Rollback:** README "Rollback (staging)": revert in Git (Instant Rollback as a stop-gap), forward-fix migrations only.

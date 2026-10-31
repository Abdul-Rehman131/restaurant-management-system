# Plan: Phase 1 (MVP, Dine-In core)

Status: **In progress.** Scope: modules M1 to M10 ([spec.md](spec.md) section 11). Gaps and
decisions G1 to G16 from [plan-phase0.md](plan-phase0.md) section 0 apply. Every business write
follows [ADR 001](adr/001-business-logic-in-postgres.md) and the conditions of
[ADR 002](adr/002-supabase-confirmed.md). Work is local only until the staging setup is done.

## Slices
Each slice is one branch from `develop` and one or more PRs. A slice is done when its checks
are green (`db:reset`, `db:test`, `db:lint`, `db:types`, `lint`, `typecheck`, `test`, `build`, `size`).

| Slice | Scope | Main outputs |
|---|---|---|
| **S1** Backend functions | All P1 business RPCs, audit triggers (BR-24), Realtime broadcast triggers and topic authorization, Zod response schemas, shared SQL validation helper | Migrations, pgTAP for every function and role, `packages/shared/src/schemas/*` |
| **S2** Waiter app | Tables, order entry (categories, search, quantity, notes), Send to Kitchen, Add More Items, Ready alert, Served, Request Bill, move table | `apps/staff-app` waiter routes, request id per submission |
| **S3** Kitchen screen | Live queue by batch, age colours (G11), ADD-ON marker, Preparing and Ready, Sold Out list | Kitchen route, no money fields anywhere |
| **S4** Cashier and payments | Open bills, counter Take Away, payment pad (Cash, Card, split), 80 mm receipt, handover, cancel with reason | Cashier routes, print style |
| **S5** Admin | Menu with photos (Storage), categories, tables, settings, `staff-admin` Edge Function (create with confirmed `@staff.invalid` email, deactivate with Auth ban, reactivate, reset password), MFA enforcement (aal2 for admin writes), basic daily report (M9) | Admin routes, Edge Function, Storage bucket and policies |
| **S6** Simulated day and hardening | 50-order simulated day with total reconciliation, concurrency and reconnect-resync tests, smoke load test, Playwright e2e for every done criterion, browser matrix, one-page user guide per role | Scripts, e2e suite, `docs/guides/*` |

## Done criteria (spec 11, P1) mapped to slices
| # | Done criterion | Built in | Proven by |
|---|---|---|---|
| 1 | A waiter creates a 5-item order for a table on a phone in under one minute | S2 | S6 e2e (phone viewport, timed) |
| 2 | Order on the kitchen screen within 2 s of Send; Ready alert to the waiter within 2 s | S1 (broadcast triggers, topics), S2, S3 | S1 pgTAP (who receives what), S6 e2e with timing |
| 3 | Add-ons appear marked ADD-ON; bottled drinks never reach the kitchen | S1 (`add_items_to_order`, `get_kitchen_queue`), S3 | S1 pgTAP, S6 e2e |
| 4 | A Sold Out change shows on all screens within 2 s | S1 (`set_item_availability`, menu broadcast), S2 to S4 | S1 pgTAP, S6 e2e with timing |
| 5 | Cash, Card and split payments; the receipt prints; the table becomes Available | T6 (`record_payment`), S1 (`void_payment`), S4 | pgTAP, S6 e2e (print preview) |
| 6 | Every permission in spec section 4 is verified by automated tests | S1 (database), S2 to S5 (screens) | S1 pgTAP role matrix per function, S6 e2e per role |
| 7 | A double tap on Send creates only one order | S1 (request id on every mutation), S2 | S1 pgTAP, S6 e2e (double click, retried request) |
| 8 | The Admin sees today's sales, order count and top items, matching the test data | S1 (sales summary RPC), S5 | S1 pgTAP fixture, S6 simulated day |
| 9 | A simulated day of at least 50 orders ends with no wrong totals and no lost orders | S6 | S6 script with nightly-style reconciliation |
| 10 | Works on current Android Chrome, iOS Safari and desktop Chrome or Edge | S2 to S5 | S6 Playwright projects plus a manual device check |

## S1 function list
`add_items_to_order`, `set_batch_status`, `set_order_status`, `request_bill`,
`set_item_availability`, `remove_or_cancel_item`, `cancel_order`, `apply_discount`,
`void_payment`, `move_order_table`, `get_kitchen_queue`, `get_open_bills`, `get_sales_summary`,
plus `create_order` gaining an optional `p_waiter_id` (ADR 002). Read-only RPCs check the role
first and return `jsonb` with a Zod schema; mutations take a `request_id` and replay the stored
result on a retry.

## S1 as built: decisions where the spec is open
- **Cancelling:** an order only from Pending, Accepted or Preparing (spec 6.4); after Ready, only lines. Every stored line was sent (G5), so `remove_or_cancel_item` is Cashier and Admin only, for a whole line. Cancelling the last live line cancels the order.
- **Paid orders** take no new items, cancellation, discount or bill request: an Admin voids the payment first.
- **Completion (BR-12, G9):** a Dine-In order paid before Served completes when served. A Take Away order paid before Ready stays Ready until the cashier hands it over (`set_order_status` to Completed).
- **Kitchen:** Sent, then Preparing, then Ready; skipping Preparing is refused. A drinks-only add-on never reopens the order: it is Ready, or Served on a Served order.
- **Bill:** adding items clears a pending bill request.
- **Void:** a void on a Completed order reopens it (Dine-In Served with the bill requested; Take Away Ready). It is refused while a new order holds the table.
- **Discount:** a fixed amount only (no percentage); 0 removes it; the reason is kept.
- **Requests:** a request id is bound to its arguments; reusing it with other arguments is `REQUEST_ID_CONFLICT`.
- **Report (M9):** sales are Completed orders; paid but unfulfilled orders count as open. Top-item sales are before discount.
- **Added:** `get_menu_availability` (the chef's Sold Out list, no prices).
- **Realtime topics:** `staff:orders`, `staff:kitchen`, `staff:waiter:<id>`, `staff:tables`, `staff:menu`. Payloads are ids only.

## S2 as built: waiter app decisions
- **My tables** (on by default) shows my tables plus the free ones, so a waiter can still open any free table (Q4). Another waiter's busy table shows its status only (RLS hides the order).
- **Before Send** the bar shows the item count only, no total or estimate. Menu rows show the unit price from the menu. Totals appear after Send, from the server.
- **Cart and request id** stay on the device until the server confirms. One request id per send, kept across retries and edits: a send that did go through answers `REQUEST_ID_CONFLICT` instead of making a second order or batch.
- **Offline**: the last menu is cached on the device for browsing and search; Send and every action are disabled.
- **Alerts**: a batch alerts only when it was seen in another status first, so opening the app never replays old alerts, and a drinks-only add-on never rings. Sound needs Start shift (a tap); mute is per device.
- **Strings**: the `waiter` and `rpc` i18n namespaces load with the role chunk; every RPC error code has a message (Vitest checks all codes in the migrations).
- **Bundles**: role chunks import the signed-in shell module, so modules they share with it stay in the shell chunk instead of extra shared files (plan 4.10).
- **e2e**: a failure with `net::ERR_NETWORK_CHANGED` comes from the host's network changing (seen with a Wi-Fi drop), and the fixture names it; tests that assert exact order numbers clear the counters in their own transaction.

## S3 as built: kitchen screen decisions
- **Queue**: `get_kitchen_queue` now also returns `customer_name` (new migration), so a Take Away ticket is called by name. Still no money field; an e2e test checks every API answer and Realtime frame the chef receives.
- **Ticket age** counts from the batch's `sent_at` on the server's clock (the queue's `server_time`). Green under `kitchen_warn_min`, amber to `kitchen_late_min`, red after; each band also has an icon, the minutes and a word (On time, Waiting, Late).
- **Recently ready** lists the tickets marked Ready on this screen (device-local, last 6). A Ready ticket stays on the board for 4 s first. There is no undo in S3.
- **Sold Out list** shows every active item, drinks included: a bottled drink can run out too.
- **Chime** for new tickets plays after Start shift, unless muted; the first load never chimes.
- **e2e projects**: each role spec runs on its device project (waiter on phone, kitchen on a landscape tablet), so "skipped" counts only real skips. Tests that change an account use a disposable one (`createStaff` in `e2e/support.ts`), never a shared demo login, so projects need no fixed order (changed in S4).

## S4 as built: cashier decisions
- **Bill list order**: Bill Requested first (oldest request first), then Ready Take Away, then the rest by age (sorted on the device from `get_open_bills`). A paid order that is not fulfilled yet stays on the list.
- **Amounts on the screen** are the server's: totals from the order, paid and due from `get_open_bills`. Two typing aids are worked out on the device and checked by the server: the change preview (cash received minus amount due), and in a split the card part, which starts at what the cash part leaves. After paying, the confirmation shows the server's `change_due`.
- **Typed amounts** are parsed as decimal text into integer minor units (`parseAmount`), never through a float. "Too little cash" is hinted while typing; the server still decides (`TENDERED_INVALID`).
- **Quick cash**: Exact, then the next round 500 and 1000 of the currency's major unit; equal amounts are shown once.
- **Actions**: Mark served only for a Ready Dine-In; Hand over only for a Ready, paid Take Away; cancel the order only before Ready and before payment; cancel a whole line only (S1). Discount and void are Admin only; a Cashier sees a hint. An Admin uses the same screens at `/cashier`.
- **Receipt**: dated at the last live payment (else the order time), in the settings time zone. Cancelled lines are left out, and rows that are zero are left out (service charge, tax, discount). Only the receipt prints (80 mm print stylesheet). Auto-print is a per-device switch.
- **Counter Dine-In**: the waiter is optional ("No waiter (counter)").
- **Live updates**: every Realtime join refetches, the first one too, so a change between the first read and the join is never missed (fixed in S4 for all roles).
- **Keyboard**: shortcuts are ignored while typing in a field (except Ctrl+P) and while a dialog is open; Escape in a field leaves the field, otherwise it goes back to the list.
- **e2e data**: cashier tests create and archive their own tables (101 and up); tests that change an account use a disposable one (`createStaff`).
- **Menu picker layout** (waiter and counter): the search and chips stay on top and only the list scrolls, in its own focusable region between them and the Send bar. Nothing scrolls under a sticky bar, so no button is ever half covered (CI failed axe target-size on a half-covered Add button). e2e checks 44 px (touch) and 40 px (desk) targets and runs axe with a button half past the bar.

## S5 as built: admin decisions
- **MFA**: required for every Admin, no "Skip". `private.require_role` refuses an Admin below `aal2` (`MFA_REQUIRED`), so every Admin RPC needs the code step, reads included (stricter than "writes only"; one check, nothing to forget). `my_role()` and RLS are unchanged, so the MFA screen and the account check still work. Uploads to `menu-images` and `staff-admin` check `aal2` too. Other roles have no second factor in P1.
- **MFA recovery**: another Admin uses **Reset two-step sign-in** (`staff-admin reset_mfa`: factors removed, sessions revoked, audited); emergency only, the owner removes the factor in the Supabase dashboard (README). Keep two active Admins.
- **Staff writes**: the database half is `service_role` only and acts as the calling Admin (`private.act_as_admin`), so the request id replay, the guards and the audit log record the Admin. The browser cannot call them; it calls `staff-admin`, which checks Auth, `my_role()` and `aal2`, and answers only `STAFF_APP_ORIGINS`.
- **Staff rules**: the username cannot change. A temporary password (3 groups of 4, no look-alike characters) is shown once; a retried create or reset (same request id, first answer lost) returns the same account with a new password. A role change and a password reset revoke the person's sessions. Deactivation revokes sessions and bans the login (10 years) until reactivation; a banned sign-in shows "not active". An Admin cannot deactivate, demote, or reset the password or MFA of their own account (`CANNOT_CHANGE_SELF`); `LAST_ADMIN` can then only happen when two Admins act on each other at once (row locks), proven in pgTAP.
- **Menu**: archive needs a reason, restore does not; a category with active items cannot be archived; restore needs a free name (and an active category). An edit sends the whole item. Order changes with up and down buttons, inside one category (filter the list by category). Cost price only in `admin_menu` and the Admin screens.
- **Photos**: resized in the browser to at most 1200 px and encoded as WebP (quality 0.82, then 0.7, 0.55) to fit the 1 MiB bucket limit; sources over 20 MB are refused. Every upload is a new `items/<uuid>.webp` (never overwritten; old photos stay, there is no delete policy). A browser that cannot encode WebP (Safari) gets "use Chrome or Edge to add photos".
- **Tables**: active numbers are unique; archive is refused while an order is open (the server decides; the dialog shows its message); restore needs a free number. Sections are free text with suggestions.
- **Settings**: a save sends only the changed values (and the audit entry lists only those). The currency (code and decimals) is locked once any order exists (`CURRENCY_LOCKED`). Rates are typed as percent with up to 2 decimals (basis points in the database), the rounding step in the currency's major unit, the cut-off before 12:00, kitchen Waiting 1 to 240 minutes and Late after it, up to 480. The tax registration number prints on the receipt when set. Other screens pick up a change on their next settings read (focus, reconnect, or after 5 minutes), not live.
- **Bill check**: line totals typed one per line (quantity x price), Dine-In or Take Away, an optional discount; the server's `compute_order_totals` with today's settings. Nothing is written.
- **Dashboard**: the business day defaults to the server's current one. Sales are Completed orders; Open bills are the day's unfinished orders; sales by hour use the order's creation time in the settings time zone, ordered from the cut-off hour. Charts (Recharts) load lazily inside the admin area (192.6 KB with charts, budget 250 KB) and each has a Table tab with the same numbers. Order changes refresh it live.
- **DataTable**: a small component of our own (search, filters, paging, cards on phones) instead of TanStack Table; enough for one restaurant's few hundred rows.
- **Bundles**: the admin strings moved out of the shell's `common` namespace; the lazy chart chunk imports the signed-in shell like every role chunk, so React and friends are not split into extra shared files. The signed-in shell stays at 178.6 KB.
- **e2e**: each test that needs an Admin makes its own disposable one and enrols TOTP through the Auth API. A shared Admin cannot work in parallel: when an Admin passes the code step, Auth ends that Admin's other password-only sessions. The seed `admin` is never used by tests. The settings test's temporary restaurant name keeps the "Ember Kitchen" prefix that other specs check.

## S6 as built: hardening decisions
- **Own password**: **Change password** in the Account menu for every role. New and reset accounts carry `profiles.must_change_password`. While it is set, `private.require_role` raises `PASSWORD_CHANGE_REQUIRED` and `my_role()` is NULL, so RLS reads return nothing. The app routes to `/account/password` through `my_account()`. The `account` Edge Function checks the rules (10 to 72 characters, not the current one, not the username), checks the current password with a sign-in, sets the new one with the person's own session, clears the flag and ends their other sessions. It is audited and replayable by request id. Auth's own minimum is 10 too.
- **`my_role()` is now NULL for an Admin below aal2** (S5 left it unchanged). A stolen aal1 Admin token reads nothing through RLS, not only no RPC. The MFA screen uses `my_account()`, which still answers at aal1.
- **Robustness**: an error boundary per role route (Reload screen), not-found pages inside each role with its navigation kept, and an error with Try again wherever a list can fail. No blank screens: `robustness.spec`.
- **Sentry**: built only when `VITE_SENTRY_DSN` is set (a dynamic import, so the bundles do not change without it). It sends errors only: no tracing, no replay, no user, cookies, headers, bodies or query strings. Release = `VERCEL_GIT_COMMIT_SHA`, else `GITHUB_SHA`, else `local`. No DSN exists yet.
- **Headers**: HSTS on both apps. The staff app has a `Content-Security-Policy-Report-Only`, to be enforced after the staging check.
- **Scripts (local only)**: `sim:day` (50+ orders, 7 reconciliation checks), `load:smoke` (50 Realtime screens, 200 orders), `db:restore-check` (dump, restore, row counts). They share `scripts/local-stack.mjs`.
- **Realtime limit**: local and hosted Free allow about 100 messages a second, counted per screen delivered to. With 50 kitchen screens, each order is about 500 messages, so `load:smoke` paces 200 orders over 20 minutes (3x, 84 messages a second, nothing missed). Faster runs are throttled (`too_many_requests`): 5x lost a third of the kitchen events. A real restaurant (a few kitchen screens) stays far below the limit.
- **Accessibility sweep**: `a11y.spec` (every screen, light and dark, phone and desktop), `keyboard.spec` (cashier and admin, no mouse, focus visible at every stop), and kitchen sizes at tablet size in `kitchen.spec`. Fixes it found:
  - Dialogs and sheets opened without a Radix Trigger now return focus to what opened them (`useReturnFocus` in `packages/ui`).
  - The MFA code field takes focus.
  - An unknown `/cashier` address on a phone shows "not found" instead of a hidden pane.
  - Axe found no serious issue on any screen.
- **Docs**: [p1-acceptance.md](p1-acceptance.md), [security-review.md](security-review.md), [backup-restore.md](backup-restore.md), [uat-script.md](uat-script.md), the role guides in [guides/](guides/), and the go-live additions in [setup-checklist.md](setup-checklist.md) 6.1 and 7.

## Out of P1
Online orders, deals and pg_cron jobs (P2); delivery, riders and reservations (P3); profit,
expenses, shifts, the audit log viewer and `daily_summary` (P4).

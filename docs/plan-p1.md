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

## Out of P1
Online orders, deals and pg_cron jobs (P2); delivery, riders and reservations (P3); profit,
expenses, shifts, the audit log viewer and `daily_summary` (P4).

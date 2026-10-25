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

## Out of P1
Online orders, deals and pg_cron jobs (P2); delivery, riders and reservations (P3); profit,
expenses, shifts, the audit log viewer and `daily_summary` (P4).

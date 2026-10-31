# P1 acceptance: done criteria, permissions and business rules mapped to tests

Each P1 requirement from the spec (11 "Phase 1" done criteria, 4 permission matrix, 6.5 business
rules) mapped to the automated test that proves it. **Unproven** marks what no automated test
can show; those items go to the UAT day ([uat-script.md](uat-script.md)) or the staging check
([setup-checklist.md](setup-checklist.md) 6.1).

Where the tests are:
- **pgTAP** `supabase/tests/NNN_*.test.sql` (`pnpm db:test`): database functions and RLS, every role.
- **e2e** `apps/staff-app/e2e/*.spec.ts` (`pnpm e2e`): real browser against the local stack, on a
  phone (Pixel 7), a landscape tablet (kitchen) and a desktop (cashier, admin).
- **sim** `pnpm sim:day`: a simulated day of 50+ orders through the real RPCs, with reconciliation.
- **load** `pnpm load:smoke`: 50 kitchen screens and 200 orders (section 4).

## 1. Done criteria (spec 11, Phase 1)

| # | Criterion | Proof | Status |
|---|---|---|---|
| 1 | Waiter: 5-item order on a phone in under 1 minute | e2e `waiter.spec` "order entry: search, categories, sold out, review with notes, a double tap sends one order" (the full flow on a phone) | **Unproven** timing with a real person: UAT row 4 |
| 2 | Kitchen within 2 s of Send; Ready alert to the waiter within 2 s | e2e `kitchen.spec` "the order loop" (`timeout: 2_000`), `waiter.spec` "Ready alert: … tone, vibration and banner"; load: p95 create to kitchen event (section 4) | Proven locally. **Unproven** on staging over the internet (UAT rows 5, 7) |
| 3 | ADD-ON in the kitchen; bottled drinks never there | e2e `kitchen.spec` "the order loop … ADD-ON", "a drinks-only order never reaches the kitchen (BR-07)"; pgTAP 190, 290 | Proven |
| 4 | Sold Out on all screens within 2 s | e2e `kitchen.spec` "Sold Out sheet … within 2 s", `waiter.spec` "an item marked Sold Out elsewhere greys out live"; `admin.spec` "a new category and item … within 2 s" | Proven locally |
| 5 | Cash, Card, split; receipt prints; table Available | e2e `cashier.spec` "exact cash … frees the table", "cash with change, card with a reference, and a split", "the receipt … prints (Ctrl+P, auto)"; pgTAP 120 | Proven (browser print dialog). **Unproven** on the real 80 mm printer (D3): UAT row 15 |
| 6 | Every permission in spec 4 tested | Section 2 below | Proven for every P1 row |
| 7 | Double tap on Send creates one order | e2e `waiter.spec` "… a double tap sends one order", `cashier.spec` "… a double click pays once"; pgTAP 110, 130 (concurrent replay), 990 | Proven |
| 8 | Admin sees today's sales, count, top items matching the test data | sim check "dashboard matches"; e2e `admin.spec` "dashboard: numbers, charts with their tables"; pgTAP 310, 400 | Proven |
| 9 | 50+ order day, no wrong totals, no lost orders | sim, 3 runs PASS (section 3) | Proven |
| 10 | Android Chrome, iOS Safari, desktop Chrome or Edge | e2e runs Chromium only: Pixel 7 emulation, Galaxy Tab landscape, desktop Chrome | **Unproven**: iOS Safari, real Android devices and Edge. UAT row 24 |

## 2. Permission matrix (spec 4)

Every refused call raises `NOT_AUTHORIZED` (or a named rule code). The e2e column proves the
screens follow the server.

| Action | pgTAP (every role tried) | e2e |
|---|---|---|
| Create a Dine-In order (Admin, Cashier, Waiter) | 110, 180 (chef and rider refused, a waiter names only self) | `waiter.spec`, `cashier.spec` counter Dine-In |
| Create a counter Take Away (Admin, Cashier) | 110 ("a waiter cannot create a Take Away order"), 180 | `cashier.spec` counter Take Away |
| Add items to an open order (Admin, Cashier, own Waiter) | 190 ("another waiter may not") | `waiter.spec` add-on |
| Remove an item before send (all three) | Not a server action: unsent lines live only in the device's cart | `waiter.spec` review (remove a line) |
| Cancel after send, reason required (Admin, Cashier) | 250 ("the owning waiter may not"), 220 | `cashier.spec` "cancelling … needs a reason" |
| Discount, reason required (Admin) | 260 ("cashier may not (BR-10)") | `cashier.spec` "a cashier cannot discount or void; an admin can" |
| Mark Preparing and Ready (Admin, Cashier, Chef) | 200 (waiter and rider refused) | `kitchen.spec`, `cashier.spec` counter Take Away |
| Mark Served (Admin, Cashier, Waiter) | 210 ("the owning waiter may") | `waiter.spec`, `cashier.spec` |
| Mark Sold Out (Admin, Cashier, Chef) | 240 ("waiter may not", "rider may not") | `kitchen.spec` Sold Out sheet |
| Request the bill (Admin, Cashier, Waiter) | 230 ("another waiter may not") | `waiter.spec`, `cashier.spec` |
| Record payment, receipt (Admin, Cashier) | 120, 270 | `cashier.spec` |
| Edit menu, prices (Admin) | 360 ("cashier cannot change the menu", "cannot read cost prices"), 370, 390 | `admin.spec` "cashier, waiter and chef cannot open admin or call its functions" |
| View reports (Admin) | 310 ("cashier may not", "deactivated admin may not"), 400 | `admin.spec` |
| Manage staff and settings (Admin) | 380, 350, 410 | `admin.spec` staff, settings, MFA |
| Admin needs MFA (aal2) for all of the above | 340, 380, 390 | `admin.spec` "MFA: … Admin calls need aal2", `account.spec` |
| Read only what the role needs (RLS) | 032 (select matrix), 001 (no grant to `anon`, no write grant) | `cashier.spec` "the waiter and the chef cannot reach cashier data" |
| Online orders, Online ON/OFF, riders (P2, P3) | Not built in P1 | n/a |

## 3. Business rules (spec 6.5)

| Rule | Proof | Status |
|---|---|---|
| BR-01 server prices | pgTAP 100, 110 (a client-supplied price is rejected, `ITEM_FIELD_NOT_ALLOWED`), 990; sim totals check | Proven |
| BR-02 name, price, cost snapshot | pgTAP 110, 190; e2e `admin.spec` "a price change applies to new orders only" | Proven |
| BR-03 ORD-YYYYMMDD-NNN, daily sequence | pgTAP 090, 130 (concurrent); sim "numbers 1..N with no gap" | Proven |
| BR-04 business-day cut-off | pgTAP 090 (before and after the cut-off, time zone) | Proven |
| BR-05 one open order per table | pgTAP 110, 280; sim BR-05 check | Proven |
| BR-06 add-on batch, ADD-ON | pgTAP 190, 290; e2e `kitchen.spec` | Proven |
| BR-07 no-kitchen items never shown | pgTAP 290; e2e `kitchen.spec` drinks-only | Proven |
| BR-08 Ready when all kitchen batches Ready; no-kitchen order Ready at once | pgTAP 200, 110 | Proven |
| BR-09 remove before send only; cancel after with a reason (Cashier, Admin) | pgTAP 250, 220 | Proven |
| BR-10 discount Admin only, with a reason | pgTAP 260; e2e `cashier.spec` | Proven |
| BR-11 Cash, Card, split adding up | pgTAP 120 (mismatch refused); e2e `cashier.spec` | Proven |
| BR-12 Completed = fulfilled and paid; table freed | pgTAP 120, 210; e2e `cashier.spec`; sim "no stuck tables" | Proven |
| BR-13 Sold Out everywhere at once, existing orders unaffected | pgTAP 240; e2e `kitchen.spec`, `waiter.spec` | Proven |
| BR-14 archive, never delete | pgTAP 001 (no DELETE grant), 360, 370; e2e `admin.spec` archive | Proven |
| BR-15 same request once | pgTAP 110, 130, 990 (every mutating RPC replays); e2e double tap, double click; sim replays | Proven |
| BR-16 tax and service charge from Settings | pgTAP 100, 350; e2e `admin.spec` "Bill check matches the order totals" | Proven |
| BR-17 to BR-23, BR-25 | Online ordering, delivery, reservations (P2, P3) | Not in P1 |
| BR-24 audit log of cancellations, discounts, price changes | pgTAP 080, 320 | Proven |

## 4. Simulated day and load (S6)

**`pnpm sim:day`**, run 3 times, PASS each time. Run 3:
- 52 orders (24 Dine-In, 28 Take Away), with 4 waiters on 8 tables;
- 11 add-ons, 6 paid before serving;
- 5 orders and 4 lines cancelled, 1 discount, 1 void;
- 15 cash, 15 card and 18 split payments; 7 replays.

All 7 checks passed: payments equal the completed totals; 47 of 47 totals match a fresh
recalculation; order numbers 1..N with no gap; no stuck tables; BR-05; the dashboard matches.

**`pnpm load:smoke`**, local stack on one Windows laptop (Docker Desktop):
- 50 of 50 Realtime kitchen screens joined;
- 200 of 200 orders (5 at a time) in 1,194 s, a 3x compressed hour (603 orders an hour);
- 99,850 kitchen messages delivered, 84 a second, with **0 missed events and 0 failed orders**.
  Result: PASS.

| | p50 | p95 | max | n |
|---|---|---|---|---|
| `create_order` | 58 ms | 353 ms | 1,436 ms | 200 |
| `set_batch_status` | 34 ms | 192 ms | 746 ms | 400 |
| `record_payment` | 33 ms | 186 ms | 498 ms | 200 |
| `create_order` start to the kitchen event (all 50 screens) | 71 ms | 349 ms | 1,303 ms | 10,000 |

Local limits, read the numbers with these in mind:
- **One laptop.** The database, Realtime, the 50 screens and the 5 order workers share one
  machine; on a quiet machine the p95s were about 30 to 40 ms (an earlier, throttled run).
- **The Realtime message limit** (about 100 a second locally and on the hosted Free plan, 500 on
  Pro) is counted per screen delivered to. 50 kitchen screens make about 500 messages per order,
  so the run is paced at 3x: at 5x (93 a second) a third of the kitchen events were dropped
  (`too_many_requests`), and screens would only catch up on their next resync. A real
  restaurant with 2 to 3 kitchen screens sends about 30 messages per order.
- **No network.** Hosted timings add the internet round trip; the 2-second targets must be
  confirmed on staging (section 6).

## 5. Also proven in S6

- **Accessibility.** `a11y.spec`: axe on every screen of every role, light and dark, phone and
  desktop. `keyboard.spec`: the cashier and the admin by keyboard only, with a visible focus at
  every stop. `kitchen.spec`: tablet text sizes and target sizes.
- **Robustness.** `robustness.spec`: not-found pages inside each role, deep-link reloads, a
  failed role download, list errors with retry, an expired session.
- **Own password, forced change, MFA order.** pgTAP 410; e2e `account.spec`.
- **Backup restores with equal row counts.** `pnpm db:restore-check`
  ([backup-restore.md](backup-restore.md)).

## 6. Not proven by automation (to do by hand)

1. Timing with a real waiter on a real phone (criterion 1).
2. The 2-second targets over the internet against staging (criteria 2 and 4). Locally the p95 is
   well under 1 s.
3. iOS Safari, real Android phones and tablets, and Edge (criterion 10).
4. The real receipt printer and 80 mm paper (criterion 5, D3).
5. Hosted-only security settings: the sign-in rate limit (not enforced by the local stack),
   HSTS, the CSP report, and leaked password protection
   ([security-review.md](security-review.md) 4 and 7).
6. A restore of a real staging backup into a fresh project (the local check passes;
   [backup-restore.md](backup-restore.md)).
7. Realtime at Free-plan limits during a rush (section 4): the screens resync, but events can
   arrive late.

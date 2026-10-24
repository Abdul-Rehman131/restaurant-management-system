# ADR 001: Business logic lives in PostgreSQL functions

- **Status:** Accepted (T6 proof complete, 24 October 2026)
- **Applies to:** every function that changes business data (P1 onwards)
- **Reference implementations:** `create_order` and `record_payment` in `supabase/migrations/`

## Context
The spec (7.2) puts business rules in PostgreSQL functions that run in one transaction, behind
Row Level Security. The browser can never change a price, a status or a permission by itself.
T6 had to prove that this works for the two most important operations before P1 builds on it.

## Decision
Every write goes through a `public` function with the shape below. Clients have **no**
INSERT, UPDATE or DELETE rights on any business table (T5), so a function is the only way in.

### The template
```sql
-- What it does, in one line. Errors: list every code it can raise.
create function public.do_something(p_request_id uuid, p_order_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer          -- runs as the owner: can write despite RLS and missing grants
set search_path = ''      -- REQUIRED with security definer: always schema-qualify names
as $$
declare
  v_user uuid := auth.uid();
begin
  -- 1. Role first. Reads profiles, so deactivated staff are refused immediately.
  perform private.require_role('admin', 'cashier');

  -- 2. Idempotency (BR-15): same request id -> same result, never a second write.
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('do_something:' || p_request_id::text, 0));
  -- if this request id already produced a result: return it with "replayed": true

  -- 3. Lock what you will change (FOR UPDATE), then check the business rules.
  -- 4. Validate ALL input before the first write. Reject unknown JSON keys.
  -- 5. Write. Money only through private.calc_order_totals(). Status history for status
  --    changes. Table status only from order functions.
  -- 6. Return a compact jsonb summary (private.order_summary / payment_summary).
end;
$$;

revoke all on function public.do_something(uuid, uuid, jsonb) from public, anon;
grant execute on function public.do_something(uuid, uuid, jsonb) to authenticated;
```
Then add the function to the RPC allow-list in `supabase/tests/001_security_guards.test.sql`.
The guard test fails until you do. That is deliberate: every new entry point is reviewed.

### Rules in short
| Rule | Why |
|---|---|
| `security definer` + `set search_path = ''` | Writes despite RLS. Prevents search-path hijacking. The guard test enforces it. |
| `private.require_role(...)` is the first statement | Role from `profiles`, not the JWT. Deactivation applies on the next call. |
| `request_id` + advisory lock + replay | A double tap or network retry never creates a second order or payment. |
| Lock rows you change (`select ... for update`) | Two devices acting on the same table or bill are serialised (see the concurrency test). |
| Validate everything, then write | `raise exception` rolls back the whole call: all or nothing. |
| Accept only known JSON keys | A client cannot send `price`, `total` or anything else we did not ask for. |
| Money via `private.calc_order_totals` only | One formula, rules from `settings` (see `docs/pricing-rules.md`). |
| Stable error codes as the message | `raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001'`. The UI maps the code to an i18n message. Use `42501` for `NOT_AUTHORIZED`. |
| Helpers live in `private` | Not reachable through the API. |

### Error codes
The **message** is the stable code (upper snake case). The UI never shows it raw. It maps it
to a translated sentence (`errors.TABLE_HAS_OPEN_ORDER`). `detail` may carry extra context for
logs. Errcode `P0001` is a business rule; `42501` means not allowed.

### Testing (required before merge)
Every function gets a pgTAP file in `supabase/tests/` covering:
1. **Happy path**, with money values worked out by hand in a comment.
2. **Every error code** it can raise (`throws_ok(sql, errcode, 'CODE', description)`).
3. **Every role**: allowed roles succeed; other roles, a deactivated user and `anon` are refused.
4. **Idempotency**: the same request id twice gives one write and `"replayed": true`.
5. **"Nothing written"** after a failure, where it matters (money).
6. **Concurrency**, where two devices can collide (see `130_create_order_concurrency.test.sql`).

Helpers: `tests.login_as(user_id)`, `tests.login_as_anon()`, `tests.logout()`,
`tests.create_staff/table/item/order()`, `tests.line()` in `supabase/tests/helpers.psql`.

## Pitfalls we hit (read before writing SQL)
1. **NULL in checks.** `length(btrim(NULL)) > 0` is NULL, and a CHECK or IF treats NULL as "not false".
   Use `coalesce(..., 0) > 0`. For JSON, `coalesce(jsonb_typeof(x -> 'k'), 'missing') <> 'number'`.
2. **`array_agg(x order by 1)`** sorts by the constant 1, not the first column. Write the expression.
3. **Default privileges.** Postgres gives EXECUTE on new functions to PUBLIC. Our migrations
   revoke it globally, but always end a function migration with explicit `revoke`/`grant`.
4. **Column privileges vs RLS.** RLS filters rows, never columns. Hide columns by not granting
   them, and expose them through an Admin RPC.
5. **`supabase test db` runs every `.sql` in `supabase/tests/`.** Shared helpers are `.psql`.
6. **pgTAP runs in one transaction.** To test real concurrency, open extra sessions with dblink
   (they only see committed data).

## Consequences
- **Good:** one transaction per operation, rules that no screen can bypass, and fast tests (the
  full suite of 359 tests runs in about 13 seconds), all in standard PostgreSQL (portable, R9).
- **Cost:** PL/pgSQL is less familiar than TypeScript. Mitigated by this template, the guard
  tests, CODEOWNERS review of `supabase/**`, and the test helpers.
- **Not covered here:** Realtime notifications (P1), which are emitted after the data change.
  Channel authorization uses `my_role()` (see plan section 5).

## Alternatives considered
- **A Node/TypeScript API server** in front of the database. Familiar language, but it needs a
  hosted server (cost and ops), duplicates permission checks outside the database, and loses
  the single-transaction, RLS-backed guarantees unless re-implemented carefully. Rejected for
  P0 and P1; see the T6 decision gate report.
- **Edge Functions for every write.** Kept only for the public checkout (P2) and staff
  administration (P1), where the service role or rate limiting is needed.

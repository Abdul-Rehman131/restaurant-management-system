# ADR 002: Supabase is confirmed as the backend

- **Status:** Accepted (T6 decision gate, 24 October 2026)
- **Supersedes:** nothing. Confirms spec decision D1 after the T6 proof.
- **Related:** [ADR 001](001-business-logic-in-postgres.md) (how business functions are written)

## Decision
We stay with Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions, pg_cron). Business
rules stay in PostgreSQL functions as described in ADR 001. We do not add a Node API server.

## Reasons (from the T6 decision gate report)
1. **The proof worked.** `create_order` and `record_payment` are correct under concurrency,
   idempotent, and covered by 87 new pgTAP tests (359 in total). A Node server would still
   need the same database locks and constraints to be this safe.
2. **Fewer moving parts.** No extra server to host, monitor and secure, and no second place
   where permissions live. Rules are enforced in the database, as spec 7.2 requires.
3. **The spec's features are built in:** Auth with the access-token hook, Realtime broadcast,
   Storage for menu photos, and pg_cron for scheduled jobs (P2).
4. **The cost is manageable.** The hard part is SQL skill. ADR 001 gives a template, a
   checklist and the pitfalls; the guard tests block the dangerous mistakes; the backend lead
   reviews `supabase/**`.
5. **Low lock-in.** Standard PostgreSQL with migrations in Git (risk R9).

## Conditions (P1 week 1)
1. **Zod response schemas.** Every RPC result (`jsonb`, typed as `Json` by the generated
   types) gets a Zod schema in `packages/shared`, so screens work with typed data.
2. **A shared SQL validation helper** in the `private` schema for the repeated JSON checks
   (allowed keys, required uuid, integer in a range, optional text with a maximum length), so
   new functions do not copy the long checks from `create_order`.

## Revisit rule
If a new business function takes **more than one day** to write and test with the ADR 001
template, raise it at the next review and reconsider this decision for the remaining work.
Record the function, the time it took and what was hard.

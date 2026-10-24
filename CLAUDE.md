# Restaurant Management System

Real-time restaurant system: staff PWA (Waiter, Kitchen, Cashier, Rider, Admin) and a public
customer website, sharing one order pipeline on Supabase.

**Read @docs/spec.md first. Build only the phase I name (P0-P5). Nothing from a later phase.**
The current phase plan is in docs/plan-phase0.md. If the spec and a request conflict, ask.

## Stack
- pnpm workspaces + Turborepo, Node LTS, TypeScript strict everywhere
- apps/staff-app, apps/customer-web: React + Vite, React Router (lazy routes), TanStack Query,
  Zustand (cart and UI state only), React Hook Form + Zod, react-i18next, vite-plugin-pwa
- packages/ui: Tailwind CSS + shadcn/ui, design tokens, lucide-react icons, Recharts (admin only)
- packages/shared: generated DB types, Zod schemas, money helpers, status constants
- supabase/: Postgres, Auth, Realtime (broadcast), Edge Functions, Storage, pg_cron
- Tests: pgTAP (`supabase test db`), Vitest, Playwright. Hosting: Vercel. Errors: Sentry.

## Hard rules
1. **Prices are server-side only.** Clients send item IDs, quantities and notes, never prices
   or totals. All totals come from one SQL function (BR-01, BR-16).
2. **RLS on every table**, with no exceptions. Clients never write business tables directly: writes
   go through `SECURITY DEFINER` functions with `set search_path = ''` that check the role.
   Every new table or function ships with pgTAP tests for every role.
3. **Migrations only.** Every schema change is a new file in supabase/migrations. Never edit
   an applied migration. Never change staging or production through the dashboard.
4. **No secrets in code. The repo is PUBLIC** (GitHub secret scanning and push protection are on).
   Never commit secrets, keys or `.env` files; use `.env.local` (gitignored) and `.env.example`.
   Docs must not contain private owner or business data. The service-role key never reaches a
   browser bundle; only Edge Functions and CI use it.
5. **Money is integers** in the smallest currency unit (`bigint`). Percentages are basis
   points (`int`, 1600 = 16%). No floats for money, in SQL or TS.
6. **Archive, never delete.** Use `is_active = false` for menu, categories, tables and staff. No
   DELETE grants on business tables.
7. Every money or permission rule needs a test before merge. Order snapshots name, price and cost (BR-02).
8. Mutating RPCs take a client `request_id` (uuid) and are idempotent (BR-15).
9. The server is the source of truth: never show a status or payment change as done before the server
   confirms it. Optimistic UI is allowed only for local cart and UI state.
10. UI: build with tokens from packages/ui only (no raw hex), 44px minimum touch targets, all text
    through i18n keys, logical CSS (`ms-`/`me-`, `start`/`end`) for RTL.

## Conventions
- DB: snake_case, enums for statuses and roles, UUID keys, `timestamptz` in UTC, `branch_id` on
  business tables. TS: camelCase. RPC errors raise stable codes (e.g. `TABLE_HAS_OPEN_ORDER`)
  that map to i18n messages.
- Git: `main` is production, `develop` is staging, `feat/*` and `fix/*` branches. PRs only (squash),
  CI must pass, at least one review, Conventional Commits.

## Commands (created in P0)
```
pnpm install              # install everything
pnpm dev                  # run all apps (staff :5173, customer :5174)
supabase start            # start the local Supabase stack (Docker)
pnpm db:reset             # re-run migrations + seed.sql locally
pnpm db:test              # pgTAP tests (supabase test db)
pnpm db:types             # regenerate packages/shared/src/database.types.ts
pnpm db:new <name>        # new migration file
pnpm lint && pnpm typecheck && pnpm test   # quality gate (same as CI)
pnpm e2e                  # Playwright
pnpm build && pnpm size   # build + bundle budget check
```

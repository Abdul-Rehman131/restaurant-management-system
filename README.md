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

## Commands

| Command                                              | What it does                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`                            | Run or build all apps                                                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Quality gate (CI runs the same)                                        |
| `pnpm db:start` / `db:stop` / `db:status`            | Start, stop or inspect the local Supabase stack                        |
| `pnpm db:new <name>`                                 | Create `supabase/migrations/<timestamp>_<name>.sql`                    |
| `pnpm db:reset`                                      | Rebuild the local DB from all migrations, then run `supabase/seed.sql` |
| `pnpm db:test`                                       | Run the pgTAP tests in `supabase/tests/`                               |
| `pnpm db:lint`                                       | Lint the database schema and functions                                 |
| `pnpm db:types`                                      | Regenerate `packages/shared/src/database.types.ts` from the local DB   |
| `pnpm brand:icons`                                   | Regenerate favicon and PWA icons from `public/brand/logo-mark.svg`     |

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

## Environments

|            | Backend                                                       | Front ends                     |
| ---------- | ------------------------------------------------------------- | ------------------------------ |
| Local      | `pnpm db:start` (Docker)                                      | `pnpm dev`                     |
| Staging    | Supabase project ref `aqxmdmkforcucmktwmjj`, `ap-southeast-1` | Vercel, branch `develop` (T10) |
| Production | `rms-prod`, `ap-southeast-1` (created in T10)                 | Vercel, branch `main` (T10)    |

## Troubleshooting

- **`db:start` or `db:reset` fails right after the first install:** run it again. The first
  run can time out while images start. `pnpm db:stop`, then `pnpm db:start`, gives a clean restart.
- **Port already in use (54321–54324):** another Supabase stack is running. Run
  `npx supabase stop --all`.

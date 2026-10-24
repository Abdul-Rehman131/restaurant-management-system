// Migration history drift check, before `supabase db push` (db-deploy.yml). Reads the JSON of
// `supabase migration list --linked -o json` from stdin. Fails when:
//   * the remote has a migration that is not in supabase/migrations (applied outside Git, or a
//     migration file was renamed or deleted after it was deployed), or
//   * a pending local migration is older than the newest one already applied (it would need
//     --include-all, which this pipeline never uses; give it a new timestamp instead).
// Otherwise prints the pending migrations and exits 0. Usage:
//   supabase migration list --local -o json | node scripts/check-migration-drift.mjs
import { readFileSync } from 'node:fs';

const { migrations = [] } = JSON.parse(readFileSync(0, 'utf8'));

const remoteOnly = migrations.filter((m) => m.remote && !m.local).map((m) => m.remote);
const applied = migrations.filter((m) => m.local && m.remote).map((m) => m.local);
const pending = migrations.filter((m) => m.local && !m.remote).map((m) => m.local);
const newestApplied = [...applied, ...remoteOnly].sort().at(-1) ?? '';
const outOfOrder = pending.filter((v) => v < newestApplied);

let failed = false;
for (const v of remoteOnly) {
  console.log(
    `::error::Drift: migration ${v} is applied on the remote but not in supabase/migrations.`,
  );
  failed = true;
}
for (const v of outOfOrder) {
  console.log(
    `::error::Drift: pending migration ${v} is older than ${newestApplied}, which is already applied. Give it a new timestamp (pnpm db:new).`,
  );
  failed = true;
}

console.log(
  `Applied: ${applied.length}. Pending: ${pending.length ? pending.join(', ') : 'none'}.`,
);
process.exit(failed ? 1 : 0);

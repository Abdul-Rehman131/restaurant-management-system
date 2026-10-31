// pnpm db:restore-check — proves that a backup of the LOCAL database restores (S6).
//
//   1. pg_dump of the whole local database (custom format) inside the CLI's database container
//   2. a fresh, empty database (rms_restore_check) in the same container
//   3. pg_restore into it; any restore error fails the check
//   4. row counts of every table in public, plus the logins, MFA factors, sessions and the
//      Storage rows (bucket, photo records), compared between the two databases
//   5. the copy is dropped; PASS or FAIL
// Optional: `pnpm db:restore-check -- --keep <file>` also copies the dump out of the container
// to <file> (a real local backup; never commit it).
// The procedure for staging and production (other tools, same idea) is docs/backup-restore.md.
import { execFileSync } from 'node:child_process';

const DUMP = '/tmp/rms-restore-check.dump';
const COPY = 'rms_restore_check';
const keep = process.argv.includes('--keep')
  ? process.argv[process.argv.indexOf('--keep') + 1]
  : null;

function inContainer(command) {
  return execFileSync('docker', ['exec', 'supabase_db_rms', 'bash', '-c', command], {
    encoding: 'utf8',
  }).trim();
}
function sql(database, query) {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_rms', 'psql', '-U', 'supabase_admin', '-d', database, '-qtAc', query],
    { encoding: 'utf8' },
  ).trim();
}

const started = Date.now();
inContainer(`pg_dump -U supabase_admin -Fc -f ${DUMP} postgres`);
const size = Number(inContainer(`stat -c %s ${DUMP}`));
if (keep) execFileSync('docker', ['cp', `supabase_db_rms:${DUMP}`, keep]);

inContainer(`dropdb -U supabase_admin --if-exists ${COPY} && createdb -U supabase_admin ${COPY}`);
let restoreErrors = '';
try {
  inContainer(`pg_restore -U supabase_admin --exit-on-error -d ${COPY} ${DUMP}`);
} catch (error) {
  restoreErrors = String(error.stderr ?? error.message)
    .split('\n')
    .slice(0, 3)
    .join(' ');
}

const tables = sql(
  'postgres',
  `select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname = 'public'
       or (n.nspname || '.' || c.relname) in ('auth.users', 'auth.identities', 'auth.mfa_factors',
            'auth.sessions', 'storage.buckets', 'storage.objects'))
    order by 1`,
)
  .split('\n')
  .filter(Boolean);
const rows = tables.map((table) => {
  const original = Number(sql('postgres', `select count(*) from ${table}`));
  const restored = restoreErrors ? NaN : Number(sql(COPY, `select count(*) from ${table}`));
  return { table, original, restored, ok: original === restored };
});
inContainer(`dropdb -U supabase_admin --if-exists ${COPY} && rm -f ${DUMP}`);

const ok = !restoreErrors && rows.every((r) => r.ok);
console.log('Backup and restore check (local stack)');
console.log('='.repeat(64));
console.log(
  `Dump: ${(size / 1024 / 1024).toFixed(1)} MB, custom format${keep ? `, copied to ${keep}` : ''}`,
);
if (restoreErrors) console.log(`FAIL  restore: ${restoreErrors}`);
for (const r of rows) {
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.table.padEnd(34)} ${String(r.original).padStart(7)} -> ${String(r.restored).padStart(7)}`,
  );
}
console.log('='.repeat(64));
console.log(`${rows.length} tables compared in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exitCode = ok ? 0 : 1;

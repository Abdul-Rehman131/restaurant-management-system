// `pnpm seed:staging`: create the STAGING staff accounts (admin, cashier, waiter, chef).
//
// Runs only on your machine, by hand. The secret key comes from your shell at run time: it is
// never committed, never in CI, and never printed. Each new account gets a generated password,
// printed ONCE to this terminal and stored nowhere: put it in the vault straight away.
// Accounts that already exist are left alone (their passwords are not changed).
//
// Login emails are confirmed `<username>@staff.invalid` addresses (public.staff_login_email()).
// Refuses any project other than staging, so it can never touch production.
//
//   $env:SUPABASE_SECRET_KEY = Read-Host -MaskInput 'Staging secret key'   # PowerShell
//   pnpm seed:staging            (add -- --local to try it on the local stack)
//   Remove-Item Env:SUPABASE_SECRET_KEY
//
// Password reset for ONE existing account nobody can reset in the app (for example the only
// Admin, password unknown). Opt-in, one named account, nothing else is created or changed:
//   pnpm seed:staging -- --reset-password=admin --dry-run   checks the key and the account only
//   pnpm seed:staging -- --reset-password=admin             new temporary password, shown ONCE
// Same effect as an Admin's reset: the account must change it at the next sign-in, every session
// ends, and the audit log records an operator reset (public.ops_password_reset). Two-step sign-in
// is not touched: an Admin still needs the authenticator code after signing in.
import { randomBytes } from 'node:crypto';

import { staffLoginEmail } from '../packages/shared/src/auth.ts';

// The staging project ref is public (README, setup checklist). Production never matches.
// `--local` targets the local stack instead, to try the script out (`pnpm db:status` key).
const STAGING_REF = 'aqxmdmkforcucmktwmjj';
const local = process.argv.includes('--local');
const url = local ? 'http://127.0.0.1:54321' : `https://${STAGING_REF}.supabase.co`;

// Every argument must be known: a typo must never fall through to "create the accounts".
const resetArgs = process.argv.slice(2).filter((a) => a.startsWith('--reset-password'));
const dryRun = process.argv.includes('--dry-run');
const unknown = process.argv
  .slice(2)
  .filter((a) => a !== '--local' && a !== '--dry-run' && !a.startsWith('--reset-password'));

const staff = [
  { username: 'admin', fullName: 'Staging Admin', role: 'admin' },
  { username: 'cashier', fullName: 'Staging Cashier', role: 'cashier' },
  { username: 'waiter', fullName: 'Staging Waiter', role: 'waiter' },
  { username: 'chef', fullName: 'Staging Chef', role: 'chef' },
] as const;

function fail(message: string): never {
  console.error(`seed-staging: ${message}`);
  process.exit(1);
}

if (unknown.length > 0) fail(`unknown argument ${unknown.join(' ')}`);
if (resetArgs.length > 1) fail('--reset-password takes ONE account per run.');
const resetUser = resetArgs[0]
  ?.match(/^--reset-password=(.+)$/)?.[1]
  ?.trim()
  .toLowerCase();
if (resetArgs.length === 1 && !resetUser) fail('use --reset-password=<username>.');
if (resetUser && !staffLoginEmail(resetUser)) fail(`invalid username ${resetUser}`);
if (dryRun && !resetUser) fail('--dry-run only applies to --reset-password=<username>.');
console.log(
  `seed-staging: ${url}${resetUser ? ` (reset password: ${resetUser}${dryRun ? ', dry run' : ''})` : ''}`,
);

const key = process.env['SUPABASE_SECRET_KEY']?.trim();
if (!key) fail('set SUPABASE_SECRET_KEY in this shell first (see the top of this file).');
if (key.startsWith('sb_publishable_')) fail('that is the publishable key; use the secret key.');

// New keys (sb_secret_...) go in `apikey` only; a legacy service_role JWT also needs Bearer.
const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body };
}

/**
 * A failure after a network call: thrown, and reported by the handler at the end. Calling
 * process.exit() while fetch's connections close crashes Node on Windows (a libuv assertion).
 */
class Stop extends Error {}
function stop(message: string): never {
  throw new Stop(message);
}

// 20 random bytes, URL-safe: about 27 characters, typeable on a phone.
const newPassword = () => randomBytes(20).toString('base64url');

/**
 * --reset-password=<username>: the database half first (ops_password_reset: temporary-password
 * flag, sessions ended, audited), then the new password in Auth. If the second step fails, the
 * old password still works and must be changed at sign-in; run it again.
 */
async function resetPassword(username: string) {
  const found = await call(
    `/rest/v1/profiles?select=id,role,is_active&username=eq.${encodeURIComponent(username)}`,
  );
  if (!found.ok) stop(`reading profiles failed (HTTP ${found.status}). Check the key.`);
  const profile = (found.body as { id: string; role: string; is_active: boolean }[])[0];
  if (!profile) stop(`no account named ${username}; nothing changed.`);
  if (!profile.is_active) stop(`${username} is deactivated; reactivate it first. Nothing changed.`);
  if (dryRun) {
    console.log(`  found    ${username} (${profile.role}, active)`);
    console.log('\nDry run: the key works and the account exists. Nothing changed.');
    return;
  }

  const reset = await call('/rest/v1/rpc/ops_password_reset', {
    method: 'POST',
    body: JSON.stringify({ p_request_id: crypto.randomUUID(), p_user_id: profile.id }),
  });
  if (!reset.ok) {
    const code = (reset.body as { message?: string } | null)?.message ?? '';
    stop(`the reset failed (HTTP ${reset.status} ${code}). Are the migrations deployed?`);
  }
  const password = newPassword();
  const auth = await call(`/auth/v1/admin/users/${profile.id}`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
  if (!auth.ok) {
    stop(
      `setting the new password failed (HTTP ${auth.status}). The old password still works and ` +
        'must be changed at the next sign-in; run this again.',
    );
  }
  console.log(`  reset    ${username} (${profile.role})`);
  console.log('\nNew temporary password, shown ONCE. Put it in the vault now; it is not stored:');
  console.log(`  ${username.padEnd(8)} ${profile.role.padEnd(8)} ${password}`);
  console.log(
    '\nAt the next sign-in the app asks for a new password (an Admin enters the code first).',
  );
  console.log('Clear the terminal afterwards (cls / Clear-Host).');
}

/** Default: create the four staging accounts that do not exist yet; existing ones are left alone. */
async function createAccounts() {
  const created: { username: string; role: string; password: string }[] = [];

  for (const s of staff) {
    const email = staffLoginEmail(s.username);
    if (!email) stop(`invalid username ${s.username}`);

    const existing = await call(`/rest/v1/profiles?select=id&username=eq.${s.username}`);
    if (!existing.ok) stop(`reading profiles failed (HTTP ${existing.status}). Check the key.`);
    if (Array.isArray(existing.body) && existing.body.length > 0) {
      console.log(`  exists   ${s.username} (password unchanged)`);
      continue;
    }

    const password = newPassword();
    const user = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: s.fullName },
      }),
    });
    if (!user.ok) {
      stop(
        `creating the login for ${s.username} failed (HTTP ${user.status}). If the login exists ` +
          'without a profile (an earlier run stopped half-way), remove that user in the dashboard ' +
          'under Authentication → Users and run this again.',
      );
    }
    const userId = (user.body as { id: string }).id;

    // public.create_staff_profile(): service_role only (migration create_staff_profile).
    const profile = await call('/rest/v1/rpc/create_staff_profile', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: userId,
        p_username: s.username,
        p_full_name: s.fullName,
        p_role: s.role,
      }),
    });
    if (!profile.ok) {
      // Do not leave a login without a profile behind.
      await call(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
      stop(
        `creating the profile for ${s.username} failed (HTTP ${profile.status}); login removed.`,
      );
    }
    console.log(`  created  ${s.username}`);
    created.push({ username: s.username, role: s.role, password });
  }

  if (created.length > 0) {
    console.log(
      '\nNew passwords, shown ONCE. Put them in the vault now; they are not stored anywhere:',
    );
    for (const c of created)
      console.log(`  ${c.username.padEnd(8)} ${c.role.padEnd(8)} ${c.password}`);
    console.log('\nClear the terminal afterwards (cls / Clear-Host).');
  } else {
    console.log('\nNothing to create.');
  }
}

try {
  if (resetUser) await resetPassword(resetUser);
  else await createAccounts();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`seed-staging: ${error.message}`);
  process.exitCode = 1;
}

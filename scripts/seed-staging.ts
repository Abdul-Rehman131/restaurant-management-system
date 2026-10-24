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
import { randomBytes } from 'node:crypto';

import { staffLoginEmail } from '../packages/shared/src/auth.ts';

// The staging project ref is public (README, setup checklist). Production never matches.
// `--local` targets the local stack instead, to try the script out (`pnpm db:status` key).
const STAGING_REF = 'aqxmdmkforcucmktwmjj';
const local = process.argv.includes('--local');
const url = local ? 'http://127.0.0.1:54321' : `https://${STAGING_REF}.supabase.co`;
console.log(`seed-staging: ${url}`);

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

// 20 random bytes, URL-safe: about 27 characters, typeable on a phone.
const newPassword = () => randomBytes(20).toString('base64url');

const created: { username: string; role: string; password: string }[] = [];

for (const s of staff) {
  const email = staffLoginEmail(s.username);
  if (!email) fail(`invalid username ${s.username}`);

  const existing = await call(`/rest/v1/profiles?select=id&username=eq.${s.username}`);
  if (!existing.ok) fail(`reading profiles failed (HTTP ${existing.status}). Check the key.`);
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
    fail(
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
    fail(`creating the profile for ${s.username} failed (HTTP ${profile.status}); login removed.`);
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

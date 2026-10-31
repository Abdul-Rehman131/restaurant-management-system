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
//
// Demo data for a client demo (opt-in, staging only): the clearly fake "Ember Kitchen (Demo)"
// brand (PKR, Asia/Karachi, 04:00 cut-off, demo rates), 11 categories and 72 desi and fast-food
// items (drinks, water and anything not cooked skip the kitchen, two items Sold Out) and 14
// tables in 3 sections, the same content as the local seed (migration demo_data_v2):
//   pnpm seed:staging --demo-data --dry-run   reports what it would change; changes nothing
//   pnpm seed:staging --demo-data             adds what is missing (safe to run twice)
// It adds what is missing and upgrades the first demo set (old-only rows archived, never
// deleted); it refuses to run at all if the project
// has any data that is not demo data (public.ops_demo_data, OWNER_DATA_PRESENT).
//
// Demo staff with fixed passwords (staging demo): admin, cashier, chef, waiter1, waiter2 and
// waiter3, each with the password <username><suffix>. The suffix is read at run time from the
// environment variable DEMO_PASSWORD_SUFFIX, never written anywhere, never printed (nor are the
// passwords: only usernames). The accounts are marked keep_password (no forced change at sign-in,
// public.ops_demo_account). Safe to run again: it sets the same passwords.
//   $env:DEMO_PASSWORD_SUFFIX = Read-Host -MaskInput 'Demo password suffix'
//   pnpm seed:staging --demo-staff --set-demo-passwords --dry-run
//   pnpm seed:staging --demo-staff --set-demo-passwords
//   Remove-Item Env:DEMO_PASSWORD_SUFFIX
//
// Admin two-step sign-in on or off (staging demo; on by default, ops_set_require_admin_mfa):
//   pnpm seed:staging --admin-mfa off        (and --admin-mfa on to restore it)
// --demo-data, --demo-staff and --admin-mfa can be combined in one run. A lone "--" is ignored.
import { randomBytes } from 'node:crypto';

import { staffLoginEmail } from '../packages/shared/src/auth.ts';

// The staging project ref is public (README, setup checklist). Production never matches.
// `--local` targets the local stack instead, to try the script out (`pnpm db:status` key).
const STAGING_REF = 'aqxmdmkforcucmktwmjj';
const local = process.argv.includes('--local');
const url = local ? 'http://127.0.0.1:54321' : `https://${STAGING_REF}.supabase.co`;

// Every argument must be known: a typo must never fall through to "create the accounts". A lone
// "--" (what `pnpm seed:staging -- --flag` passes through) is ignored.
const args = process.argv.slice(2).filter((a) => a !== '--');
const resetArgs = args.filter((a) => a.startsWith('--reset-password'));
const dryRun = args.includes('--dry-run');
const demoData = args.includes('--demo-data');
const demoStaff = args.includes('--demo-staff');
const setDemoPasswords = args.includes('--set-demo-passwords');
// --admin-mfa on|off, or --admin-mfa=on|off.
const mfaIndex = args.findIndex((a) => a === '--admin-mfa' || a.startsWith('--admin-mfa='));
const mfaArg = args[mfaIndex];
const adminMfaValue =
  mfaIndex < 0 ? undefined : mfaArg?.includes('=') ? mfaArg.split('=')[1] : args[mfaIndex + 1];
const known = ['--local', '--dry-run', '--demo-data', '--demo-staff', '--set-demo-passwords'];
const unknown = args.filter(
  (a, i) =>
    !known.includes(a) &&
    !a.startsWith('--reset-password') &&
    !a.startsWith('--admin-mfa') &&
    !(mfaIndex >= 0 && !mfaArg?.includes('=') && i === mfaIndex + 1),
);

/** The staging demo accounts (--demo-staff). The old "waiter" account is left alone. */
const demoAccounts = [
  { username: 'admin', fullName: 'Demo Admin', role: 'admin' },
  { username: 'cashier', fullName: 'Demo Cashier', role: 'cashier' },
  { username: 'chef', fullName: 'Demo Chef', role: 'chef' },
  { username: 'waiter1', fullName: 'Demo Waiter One', role: 'waiter' },
  { username: 'waiter2', fullName: 'Demo Waiter Two', role: 'waiter' },
  { username: 'waiter3', fullName: 'Demo Waiter Three', role: 'waiter' },
] as const;

const staff = [
  { username: 'admin', fullName: 'Staging Admin', role: 'admin' },
  { username: 'cashier', fullName: 'Staging Cashier', role: 'cashier' },
  { username: 'waiter', fullName: 'Staging Waiter', role: 'waiter' },
  { username: 'chef', fullName: 'Staging Chef', role: 'chef' },
] as const;

/**
 * Every failure is thrown and reported by the handler at the end, which sets the exit code.
 * Never process.exit(): on Windows it can crash Node (a libuv assertion) while stderr or
 * fetch's connections are still closing, which hides the real message behind a crash.
 */
class Stop extends Error {}
function stop(message: string): never {
  throw new Stop(message);
}

/** The arguments, checked before anything connects. */
function parseArguments(): { resetUser: string | undefined } {
  if (unknown.length > 0) stop(`unknown argument ${unknown.join(' ')}`);
  if (resetArgs.length > 1) stop('--reset-password takes ONE account per run.');
  const resetUser = resetArgs[0]
    ?.match(/^--reset-password=(.+)$/)?.[1]
    ?.trim()
    .toLowerCase();
  if (resetArgs.length === 1 && !resetUser) stop('use --reset-password=<username>.');
  if (resetUser && !staffLoginEmail(resetUser)) stop(`invalid username ${resetUser}`);
  const demoModes = demoData || demoStaff || mfaIndex >= 0;
  if (demoModes && resetArgs.length > 0) {
    stop('use --reset-password in a run of its own.');
  }
  if (demoStaff !== setDemoPasswords) {
    stop('use --demo-staff together with --set-demo-passwords.');
  }
  if (mfaIndex >= 0 && adminMfaValue !== 'on' && adminMfaValue !== 'off') {
    stop('use --admin-mfa on or --admin-mfa off.');
  }
  if (dryRun && !resetUser && !demoModes) {
    stop('--dry-run only applies to --reset-password, --demo-data, --demo-staff or --admin-mfa.');
  }
  if (demoStaff) demoSuffix();
  const mode = resetUser
    ? `reset password: ${resetUser}`
    : [
        demoData && 'demo data',
        demoStaff && 'demo staff',
        mfaIndex >= 0 && `admin MFA ${adminMfaValue ?? ''}`,
      ]
        .filter(Boolean)
        .join(', ');
  console.log(`seed-staging: ${url}${mode ? ` (${mode}${dryRun ? ', dry run' : ''})` : ''}`);
  return { resetUser };
}

const headers: Record<string, string> = { 'Content-Type': 'application/json' };

/** The secret key, from this shell only; never printed. */
function useSecretKey(): void {
  const key = process.env['SUPABASE_SECRET_KEY']?.trim();
  if (!key) stop('set SUPABASE_SECRET_KEY in this shell first (see the top of this file).');
  if (key.startsWith('sb_publishable_')) stop('that is the publishable key; use the secret key.');
  // New keys (sb_secret_...) go in `apikey` only; a legacy service_role JWT also needs Bearer.
  headers['apikey'] = key;
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body };
}

/**
 * --demo-data: one call to public.ops_demo_data (service_role only), which adds the missing
 * demo rows in one transaction, or refuses as a whole when there is real data.
 */
async function loadDemoData() {
  const result = await call('/rest/v1/rpc/ops_demo_data', {
    method: 'POST',
    body: JSON.stringify({ p_dry_run: dryRun }),
  });
  if (!result.ok) {
    const error = (result.body ?? {}) as { message?: string; details?: string };
    if (error.message === 'OWNER_DATA_PRESENT') {
      stop(
        `this project already has data that is not demo data (${error.details ?? ''}). ` +
          'Nothing was changed. Demo data is only for an empty staging project.',
      );
    }
    stop(
      `loading demo data failed (HTTP ${result.status} ${error.message ?? ''}). ` +
        'Are the migrations deployed (demo_data)?',
    );
  }
  const r = result.body as {
    settings: string;
    categories_added: number;
    menu_items_added: number;
    menu_items_updated: number;
    archived: number;
    tables_added: number;
    tables_updated: number;
  };
  const verb = dryRun ? 'would add' : 'added';
  const changed = dryRun ? 'would update' : 'updated';
  console.log(
    `  settings     ${dryRun && r.settings === 'set to demo' ? 'would be set to demo' : r.settings}`,
  );
  console.log(`  categories   ${verb} ${String(r.categories_added)} (of 11)`);
  console.log(
    `  menu items   ${verb} ${String(r.menu_items_added)} (of 72), ${changed} ${String(r.menu_items_updated)}`,
  );
  console.log(`  old demo     ${dryRun ? 'would archive' : 'archived'} ${String(r.archived)}`);
  console.log(
    `  tables       ${verb} ${String(r.tables_added)} (of 14), ${changed} ${String(r.tables_updated)}`,
  );
  console.log(
    dryRun
      ? '\nDry run: nothing changed. Run it again without --dry-run to apply this.'
      : '\nDone. Running it again changes nothing.',
  );
}

/**
 * The demo password suffix, from this shell only. Never logged or written anywhere; each
 * password is <username><suffix>, and the shortest one must still be 10 characters long.
 */
function demoSuffix(): string {
  const suffix = process.env['DEMO_PASSWORD_SUFFIX'] ?? '';
  if (!suffix) stop('set DEMO_PASSWORD_SUFFIX in this shell first (see the top of this file).');
  const shortest = Math.min(...demoAccounts.map((a) => a.username.length));
  if (shortest + suffix.length < 10) {
    stop(`DEMO_PASSWORD_SUFFIX is too short: use at least ${String(10 - shortest)} characters.`);
  }
  return suffix;
}

/**
 * --demo-staff --set-demo-passwords: each demo account exists (created if missing), has the
 * password <username><suffix>, the demo full name and keep_password (ops_demo_account). An
 * existing account with another role, or a deactivated one, is reported and left alone.
 * Usernames only are printed.
 */
async function loadDemoStaff() {
  const suffix = demoSuffix();
  for (const account of demoAccounts) {
    const email = staffLoginEmail(account.username);
    if (!email) stop(`invalid username ${account.username}`);
    const found = await call(
      `/rest/v1/profiles?select=id,role,is_active&username=eq.${account.username}`,
    );
    if (!found.ok) stop(`reading profiles failed (HTTP ${found.status}). Check the key.`);
    const profile = (found.body as { id: string; role: string; is_active: boolean }[])[0];
    if (profile && profile.role !== account.role) {
      console.log(`  skipped  ${account.username} (it exists as ${profile.role}; not changed)`);
      continue;
    }
    if (profile && !profile.is_active) {
      console.log(`  skipped  ${account.username} (deactivated; reactivate it in Admin, Staff)`);
      continue;
    }
    if (dryRun) {
      console.log(`  ${profile ? 'update' : 'create'}   ${account.username} (${account.role})`);
      continue;
    }
    const password = `${account.username}${suffix}`;
    let userId = profile?.id;
    if (userId) {
      const updated = await call(`/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      if (!updated.ok) {
        stop(`setting the password of ${account.username} failed (HTTP ${updated.status}).`);
      }
    } else {
      const created = await call('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: account.fullName },
        }),
      });
      if (!created.ok) {
        stop(`creating the login for ${account.username} failed (HTTP ${created.status}).`);
      }
      userId = (created.body as { id: string }).id;
      const profileMade = await call('/rest/v1/rpc/create_staff_profile', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: userId,
          p_username: account.username,
          p_full_name: account.fullName,
          p_role: account.role,
        }),
      });
      if (!profileMade.ok) {
        await call(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
        stop(
          `creating the profile for ${account.username} failed (HTTP ${profileMade.status}); login removed.`,
        );
      }
    }
    const marked = await call('/rest/v1/rpc/ops_demo_account', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: userId, p_full_name: account.fullName }),
    });
    if (!marked.ok) {
      stop(
        `marking ${account.username} as a demo account failed (HTTP ${marked.status}). Are the migrations deployed?`,
      );
    }
    console.log(`  ${profile ? 'updated' : 'created'}  ${account.username} (${account.role})`);
  }
  console.log(
    dryRun
      ? '\nDry run: nothing changed.'
      : '\nDemo passwords set (username + your suffix). Not printed; not stored.',
  );
}

/** --admin-mfa on|off: the Admin second sign-in step (ops_set_require_admin_mfa). */
async function setAdminMfa(on: boolean) {
  if (dryRun) {
    console.log(`  admin MFA would be turned ${on ? 'on' : 'off'}`);
    return;
  }
  const result = await call('/rest/v1/rpc/ops_set_require_admin_mfa', {
    method: 'POST',
    body: JSON.stringify({ enabled: on }),
  });
  if (!result.ok) {
    stop(`switching admin MFA failed (HTTP ${result.status}). Are the migrations deployed?`);
  }
  const { changed } = result.body as { changed: boolean };
  console.log(`  admin MFA ${on ? 'on' : 'off'}${changed ? '' : ' (it already was)'}`);
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
  const { resetUser } = parseArguments();
  useSecretKey();
  if (resetUser) await resetPassword(resetUser);
  else if (demoData || demoStaff || mfaIndex >= 0) {
    if (demoData) await loadDemoData();
    if (demoStaff) await loadDemoStaff();
    if (mfaIndex >= 0) await setAdminMfa(adminMfaValue === 'on');
  } else await createAccounts();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`seed-staging: ${error.message}`);
  process.exitCode = 1;
}

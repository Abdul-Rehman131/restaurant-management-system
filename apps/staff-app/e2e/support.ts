import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { loadEnv } from 'vite';

import { expect } from './fixtures';
import { totp } from './totp';

/**
 * Helpers for role flows against the LOCAL Supabase stack (`supabase start`, seed.sql demo
 * logins). The URL and publishable key come from apps/staff-app/.env.local, as for the app.
 */
const env = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), 'VITE_');
const supabaseUrl = env['VITE_SUPABASE_URL'] ?? '';
const supabaseKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'] ?? '';

export const PASSWORD = 'demo-password-123';
export const shots = process.env['SHOTS'];

/**
 * Signs in through the login screen and waits for Auth's answer. A password sign-in hashes the
 * password on the server; at the start of a run (three browsers, a cold dev server and the
 * Docker VM sharing the CPU) it took up to 5.6 s, longer than the 5 s an assertion waits by
 * default. Waiting for the response itself, then checking where the app went, keeps the
 * tests exact without a fixed sleep.
 */
export async function signIn(page: Page, user: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const answer = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/v1/token') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  await answer;
}

/** The seed Admin's TOTP secret, enrolled by global-setup.ts before the suite. */
export function adminTotpSecret(): string {
  const secret = process.env['E2E_ADMIN_TOTP_SECRET'];
  if (!secret) throw new Error('E2E_ADMIN_TOTP_SECRET is missing: global-setup.ts did not run');
  return secret;
}

/** The MFA step on the sign-in screen: a code from the factor's secret (S5, required). */
export async function enterMfaCode(page: Page, secret: string) {
  const code = page.getByLabel('6-digit code');
  await code.fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(code).toBeHidden();
}

/** Signs in; the seed Admin also passes the required MFA step with a code. */
export async function signInAs(page: Page, user: string) {
  await signIn(page, user);
  if (user === 'admin') await enterMfaCode(page, adminTotpSecret());
}

// ===== Auth API (no browser): tokens and TOTP factors =====
async function authApi<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data as T;
}

/** A password-only (aal1) access token. */
export async function passwordToken(user: string, password = PASSWORD): Promise<string> {
  const session = await authApi<{ access_token: string }>('/token?grant_type=password', null, {
    email: `${user}@staff.invalid`,
    password,
  });
  return session.access_token;
}

/** Steps a session up to aal2 with a code from the factor's secret. Returns the new token. */
export async function verifyTotp(token: string, factorId: string, secret: string) {
  const challenge = await authApi<{ id: string }>(`/factors/${factorId}/challenge`, token, {});
  const session = await authApi<{ access_token: string }>(`/factors/${factorId}/verify`, token, {
    challenge_id: challenge.id,
    code: totp(secret),
  });
  return session.access_token;
}

/** Enrols and verifies a TOTP factor for the user through the API; returns its secret. */
export async function enrolTotp(user: string, password = PASSWORD): Promise<string> {
  const token = await passwordToken(user, password);
  const factor = await authApi<{ id: string; totp: { secret: string } }>('/factors', token, {
    factor_type: 'totp',
    friendly_name: 'e2e',
  });
  await verifyTotp(token, factor.id, factor.totp.secret);
  return factor.totp.secret;
}

/** An aal2 token for a user with a verified factor (the session's user lists its factors). */
export async function aal2Token(user: string, secret: string, password = PASSWORD) {
  const token = await passwordToken(user, password);
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
  });
  const { factors } = (await response.json()) as { factors?: { id: string; status: string }[] };
  const factor = factors?.find((f) => f.status === 'verified');
  if (!factor) throw new Error(`${user} has no verified factor`);
  return verifyTotp(token, factor.id, secret);
}

export const liveDot = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Live' }).filter({ visible: true });

/**
 * Waits until every running animation that ends (enter fades, sheets, toasts) has finished: axe and
 * screenshots then see final colours, and keys reach an overlay that is fully open. An event,
 * not a fixed sleep (a 300 ms sleep lost an Escape under load in the S2 check).
 */
export async function animationsDone(page: Page) {
  // Endless ones (skeleton pulse, spinners) never finish and are not waited for.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => null)),
    ),
  );
}

export async function expectNoSeriousAxe(page: Page) {
  // A half-faded element has lower contrast than the final one (seen on the Ready banner).
  await animationsDone(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ') ?? ''})`)).toEqual(
    [],
  );
}

/**
 * The menu picker's targets: the Add and quantity stepper buttons are at least `min` px each
 * way (44 on touch, 40 on desk; CLAUDE.md rule 10), and none is partly covered by the search
 * and chips bar. The list is scrolled so only a quarter of an Add button (10 to 12 px) shows
 * below the category chips, then axe runs: on CI (other fonts, other row heights) a button left
 * there by chance failed target-size as "partially obscured" while the list still scrolled
 * under the bar (S4).
 */
export async function expectMenuTargets(page: Page, min: number) {
  const targets = page.getByRole('button', {
    name: /^(Add |Remove |Increase quantity$|Decrease quantity$)/,
  });
  expect(await page.getByRole('group', { name: /^Quantity of / }).count()).toBeGreaterThan(0);
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    const name = await target.getAttribute('aria-label');
    expect(box, `${name ?? ''} has a box`).not.toBeNull();
    expect(
      Math.min(box?.width ?? 0, box?.height ?? 0),
      `${name ?? ''} size`,
    ).toBeGreaterThanOrEqual(min);
  }

  const adds = page.getByRole('button', { name: /^Add / });
  const add = adds.nth(Math.floor((await adds.count()) / 2));
  await add.scrollIntoViewIfNeeded();
  const straddles = await add.evaluate((button) => {
    // The category chips: the targets that covered the button (axe counts targets only).
    const chips = document.querySelector('nav[aria-label="Menu categories"]');
    if (!chips) throw new Error('no menu bar');
    let scroller = button.parentElement;
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    ) {
      scroller = scroller.parentElement;
    }
    const edge = chips.getBoundingClientRect().bottom;
    const before = button.getBoundingClientRect();
    const target = edge - (before.height * 3) / 4;
    (scroller ?? document.documentElement).scrollTop += before.top - target;
    const after = button.getBoundingClientRect();
    return after.top < edge && after.bottom > edge;
  });
  expect(straddles, 'an Add button sits across the search bar edge').toBe(true);
  await expectNoSeriousAxe(page);
}

/** SQL as the database owner, through the CLI's container (local stack only). */
export function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_rms', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

/** Closes any open order on a table and frees it, so each test starts from a free table. */
export function freeTable(number: number) {
  const open = `select id from public.orders
     where table_id = (select id from public.restaurant_tables where number = ${String(number)} and is_active)
       and status not in ('completed', 'cancelled')`;
  psql(`
    update public.order_batches set status = 'cancelled'
     where order_id in (${open}) and status not in ('served', 'cancelled');
    update public.orders set status = 'cancelled', cancel_reason = 'e2e reset', cancelled_at = now()
     where id in (${open});
    update public.restaurant_tables set status = 'available' where number = ${String(number)} and is_active;`);
}

/**
 * A disposable staff account for a test that changes the account (deactivation): never a
 * shared demo login, so no other test can be affected. A login (as seed.sql makes them) plus
 * its profile through public.create_staff_profile, the same path as real staff. Returns the
 * username; archive it afterwards with archiveStaff (archive, never delete).
 */
export function createStaff(role: 'admin' | 'cashier' | 'waiter' | 'chef'): string {
  const id = crypto.randomUUID();
  const username = `e2e-${id.slice(0, 8)}`;
  psql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
            public.staff_login_email('${username}'),
            extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(),
            '{"provider": "email", "providers": ["email"]}', '{"full_name": "E2E ${username}"}',
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at,
                                 created_at, updated_at)
    values (gen_random_uuid(), '${id}', '${id}',
            jsonb_build_object('sub', '${id}', 'email', public.staff_login_email('${username}'),
                               'email_verified', true), 'email', now(), now(), now());
    select public.create_staff_profile('${id}', '${username}', 'E2E ${username}', '${role}');`);
  return username;
}

export function setStaffActive(username: string, active: boolean) {
  psql(`update public.profiles set is_active = ${String(active)} where username = '${username}'`);
}

/**
 * A table of the test's own (number 101 and up, section "E2E"), free and active; archive it
 * afterwards with archiveTable (archive, never delete). Keeps tests off the seed tables.
 */
export function createTable(number: number) {
  psql(`
    update public.restaurant_tables set is_active = true, status = 'available'
     where number = ${String(number)} and section = 'E2E'
       and not exists (select 1 from public.restaurant_tables
                        where number = ${String(number)} and is_active);
    insert into public.restaurant_tables (number, capacity, section)
    select ${String(number)}, 4, 'E2E'
     where not exists (select 1 from public.restaurant_tables
                        where number = ${String(number)} and is_active);`);
  freeTable(number);
}

export function archiveTable(number: number) {
  freeTable(number);
  psql(`update public.restaurant_tables set is_active = false
         where number = ${String(number)} and section = 'E2E'`);
}

/** The order number of the open order on a table, from the server (not from a toast). */
export function openOrderNumber(number: number): string {
  return psql(`select o.order_number from public.orders o
                 join public.restaurant_tables t on t.id = o.table_id
                where t.number = ${String(number)} and t.is_active
                  and o.status not in ('completed', 'cancelled')`);
}

export function tableId(number: number): string {
  return psql(
    `select id from public.restaurant_tables where number = ${String(number)} and is_active`,
  );
}

export function menuItemId(name: string): string {
  return psql(`select id from public.menu_items where name = '${name}' and is_active`);
}

/**
 * A staff member calling RPCs directly, as another device would (the chef's tablet, a second
 * waiter). Signs in with the Auth password grant, then calls PostgREST with that token.
 */
export async function apiAs(
  request: APIRequestContext,
  user: string,
  options: { aal: 'aal1' | 'aal2' } = { aal: 'aal2' },
) {
  // The seed Admin's RPCs need aal2 (S5): the MFA step with the suite's factor.
  const token =
    user === 'admin' && options.aal === 'aal2'
      ? await aal2Token(user, adminTotpSecret())
      : await passwordToken(user);
  return {
    /** The access token, for calls that are not PostgREST (the staff-admin function). */
    token,
    /** A PostgREST read as this user (RLS applies), e.g. 'payments?select=id'. */
    async select<T = unknown>(path: string): Promise<T> {
      const response = await request.get(`${supabaseUrl}/rest/v1/${path}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
      });
      const body: unknown = await response.json();
      if (!response.ok()) throw new Error(`${path}: ${JSON.stringify(body)}`);
      return body as T;
    },
    async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const response = await request.post(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
        data: args,
      });
      const body: unknown = await response.json();
      if (!response.ok()) throw new Error(`${fn}: ${JSON.stringify(body)}`);
      return body as T;
    },
  };
}

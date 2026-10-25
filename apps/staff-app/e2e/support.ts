import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { loadEnv } from 'vite';

import { expect } from './fixtures';

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

/** Admin has no TOTP factor in the seed: skip the set-up prompt (enforcement is S5). */
export async function signInAs(page: Page, user: string) {
  await signIn(page, user);
  if (user === 'admin') await page.getByRole('button', { name: 'Skip for now' }).click();
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
export async function apiAs(request: APIRequestContext, user: string) {
  const login = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: supabaseKey },
    data: { email: `${user}@staff.invalid`, password: PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const { access_token: token } = (await login.json()) as { access_token: string };
  return {
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

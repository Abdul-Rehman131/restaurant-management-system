// Helpers for the scripts that drive the LOCAL Supabase stack (sim-day, load-smoke): the URL
// and publishable key from apps/staff-app/.env.local, SQL through the CLI's database
// container, sign-ins, RPC calls, TOTP codes, and disposable staff and tables. Local only:
// they refuse any URL that is not 127.0.0.1 or localhost, and never read a secret key.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const envFile = new URL('../apps/staff-app/.env.local', import.meta.url);
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
export const url = env.VITE_SUPABASE_URL ?? '';
export const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  throw new Error(`Local stack only: VITE_SUPABASE_URL is ${url || 'missing'}`);
}

/** The local demo password of the seed logins (seed.sql; local only). */
export const DEMO_PASSWORD = 'demo-password-123';

/** SQL as the database owner, through the CLI's container. */
export function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_rms', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

export class RpcError extends Error {
  constructor(fn, code, status) {
    super(`${fn}: ${code}`);
    this.code = code;
    this.status = status;
  }
}

async function post(path, body, token) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

/** A password sign-in; returns the access token. */
export async function signIn(username, password = DEMO_PASSWORD) {
  const { response, data } = await post('/auth/v1/token?grant_type=password', {
    email: `${username}@staff.invalid`,
    password,
  });
  if (!response.ok)
    throw new RpcError('sign-in', data?.error_code ?? response.status, response.status);
  return data.access_token;
}

/** An RPC as `token`; throws RpcError with the stable code on failure. */
export async function rpc(token, fn, args = {}) {
  const { response, data } = await post(`/rest/v1/rpc/${fn}`, args, token);
  if (!response.ok) throw new RpcError(fn, data?.message ?? response.status, response.status);
  return data;
}

/** A PostgREST read as `token` (RLS applies). */
export async function select(token, path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new RpcError(path, data?.message ?? response.status, response.status);
  return data;
}

// ===== TOTP (RFC 6238) for a disposable Admin =====
function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * A disposable staff login (as seed.sql makes them) with the demo password. Returns the
 * username. Archive it afterwards with archiveStaff (archive, never delete).
 */
export function createStaff(role, prefix = 'sim') {
  const id = crypto.randomUUID();
  const username = `${prefix}-${id.slice(0, 8)}`;
  psql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
            public.staff_login_email('${username}'),
            extensions.crypt('${DEMO_PASSWORD}', extensions.gen_salt('bf')), now(),
            '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at,
                                 created_at, updated_at)
    values (gen_random_uuid(), '${id}', '${id}',
            jsonb_build_object('sub', '${id}', 'email', public.staff_login_email('${username}'),
                               'email_verified', true), 'email', now(), now(), now());
    select public.create_staff_profile('${id}', '${username}', 'Sim ${username}', '${role}');`);
  return username;
}

export function archiveStaff(username) {
  psql(`update public.profiles set is_active = false where username = '${username}'`);
}

/** A disposable Admin with a verified TOTP factor; returns an aal2 access token. */
export async function adminToken() {
  const username = createStaff('admin');
  const token = await signIn(username);
  const factor = (await post('/auth/v1/factors', { factor_type: 'totp' }, token)).data;
  const challenge = (await post(`/auth/v1/factors/${factor.id}/challenge`, {}, token)).data;
  const verified = await post(
    `/auth/v1/factors/${factor.id}/verify`,
    { challenge_id: challenge.id, code: totp(factor.totp.secret) },
    token,
  );
  if (!verified.response.ok) throw new Error('could not enrol the disposable Admin');
  return { username, token: verified.data.access_token };
}

/** Tables of the script's own (a section of their own), free and active. */
export function createTables(numbers, section) {
  for (const number of numbers) {
    psql(`
      update public.restaurant_tables set is_active = true, status = 'available'
       where number = ${number} and section = '${section}'
         and not exists (select 1 from public.restaurant_tables where number = ${number} and is_active);
      insert into public.restaurant_tables (number, capacity, section)
      select ${number}, 4, '${section}'
       where not exists (select 1 from public.restaurant_tables where number = ${number} and is_active);`);
  }
  return Object.fromEntries(
    numbers.map((n) => [
      n,
      psql(`select id from public.restaurant_tables where number = ${n} and is_active`),
    ]),
  );
}

export function archiveTables(section) {
  psql(`update public.restaurant_tables set is_active = false
         where section = '${section}' and is_active and status = 'available'`);
}

/** p-th percentile (0 to 100) of a list of numbers. */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

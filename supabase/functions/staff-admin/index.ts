// staff-admin (S5, M1): the only way to create and manage staff logins.
//
// The browser (Admin screens) calls it with the Admin's access token. The service key exists
// only here, in the function's environment, never in a browser bundle (CLAUDE.md rule 4).
//
//   1. The caller: Auth verifies the access token (GET /auth/v1/user), public.my_role() called
//      WITH THE CALLER'S TOKEN must be 'admin' (profiles, so a deactivated Admin is refused at
//      once), and the session must be aal2 (MFA).
//      CORS: only STAFF_APP_ORIGINS get the CORS headers, and a request from any other Origin
//      is refused here (the local gateway answers preflights itself; this check still holds).
//   2. The database half runs in service_role-only functions (migration s5_staff_admin) with
//      the caller as p_actor: they re-check the actor, guard the self and last-Admin rules,
//      revoke sessions, replay request ids (BR-15) and write the audit log (BR-24).
//   3. The Auth half uses the Auth admin API: create the login (<username>@staff.invalid,
//      confirmed), set a generated temporary password, ban or unban.
//
// Actions (POST JSON, every one with a request_id):
//   create          {username, full_name, phone, role}          -> staff + temporary_password
//   update          {user_id, full_name, phone, role}           -> staff
//   set_active      {user_id, is_active, reason}                -> staff + sessions_revoked
//   reset_password  {user_id}                                   -> staff + temporary_password
// A retried create or reset (same request id, the first answer lost) returns the same account
// with a NEW temporary password: the first one was never seen.
//
// Errors: {"error": CODE} with 400 (business rule), 401 (not signed in), 403 (not an active
// Admin, or no MFA step), 405, or 500. The codes are the database's stable codes plus
// NOT_SIGNED_IN, BAD_REQUEST, AUTH_ADMIN_FAILED; the app maps each to a plain message.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey;
// The staff app origins (comma separated), set per environment. Local dev by default.
const allowedOrigins = (
  Deno.env.get('STAFF_APP_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const roles = ['admin', 'cashier', 'waiter', 'chef', 'rider'] as const;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** About 10 years: a deactivated login stays banned until an Admin reactivates it. */
const BAN_FOREVER = '87600h';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/** A temporary password: 3 groups of 4 from an alphabet without look-alikes (O/0, l/1). */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length);
  const chars: string[] = [];
  while (chars.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && chars.length < 12) chars.push(alphabet[byte % alphabet.length] ?? 'x');
    }
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

/** The payload of a JWT that Auth has already verified (only the aal claim is read). */
function claims(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** Step 1: the caller is a signed-in, active Admin with aal2. Returns the Admin's user id. */
async function verifyAdmin(request: Request): Promise<string> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'NOT_SIGNED_IN');

  const user = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!user.ok) throw new HttpError(401, 'NOT_SIGNED_IN');
  const { id } = (await user.json()) as { id?: string };
  if (!id) throw new HttpError(401, 'NOT_SIGNED_IN');

  const role = await fetch(`${supabaseUrl}/rest/v1/rpc/my_role`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!role.ok || (await role.json()) !== 'admin') throw new HttpError(403, 'NOT_AUTHORIZED');
  if (claims(token)['aal'] !== 'aal2') throw new HttpError(403, 'MFA_REQUIRED');
  return id;
}

/** A service_role database function. Its stable error code becomes the answer. */
async function db<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && /^[A-Z][A-Z_]+$/.test(message)) {
      throw new HttpError(message === 'NOT_AUTHORIZED' ? 403 : 400, message);
    }
    console.error(`staff-admin: ${fn} failed`, response.status, body);
    throw new HttpError(500, 'AUTH_ADMIN_FAILED');
  }
  return body as T;
}

/** The Auth admin API (service key). */
async function authAdmin(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${supabaseUrl}/auth/v1/admin/users${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function updateLogin(userId: string, changes: Record<string, unknown>): Promise<void> {
  const response = await authAdmin('PUT', `/${userId}`, changes);
  if (!response.ok) {
    console.error('staff-admin: Auth update failed', response.status, await response.text());
    throw new HttpError(500, 'AUTH_ADMIN_FAILED');
  }
}

// ===== Input =====
type Input = Record<string, unknown>;

function text(input: Input, key: string, required: boolean): string | null {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, 'BAD_REQUEST');
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, 'BAD_REQUEST');
  return value;
}

function uuid(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new HttpError(400, 'BAD_REQUEST');
  return value;
}

function role(input: Input): string {
  const value = input['role'];
  if (typeof value !== 'string' || !(roles as readonly string[]).includes(value)) {
    throw new HttpError(400, 'ROLE_REQUIRED');
  }
  return value;
}

interface StaffResult {
  staff: { id: string; username: string };
  replayed: boolean;
  sessions_revoked?: number;
}

// ===== Actions =====
async function create(actor: string, requestId: string, input: Input) {
  const username = (text(input, 'username', true) ?? '').trim().toLowerCase();
  const args = {
    username: input['username'],
    full_name: input['full_name'] ?? null,
    phone: input['phone'] ?? null,
    role: input['role'] ?? null,
  };
  const replay = await db<StaffResult | null>('staff_admin_replay', {
    p_actor: actor,
    p_request_id: requestId,
    p_function: 'staff_admin_create',
    p_target_id: null,
    p_args: args,
  });
  if (replay) {
    const password = temporaryPassword();
    await updateLogin(replay.staff.id, { password });
    return { ...replay, temporary_password: password };
  }

  if (!usernamePattern.test(username)) throw new HttpError(400, 'USERNAME_INVALID');
  const fullName = text(input, 'full_name', true);
  const phone = text(input, 'phone', false);
  const staffRole = role(input);

  const password = temporaryPassword();
  const created = await authAdmin('POST', '', {
    email: `${username}@staff.invalid`,
    password,
    // .invalid addresses never receive mail: an unconfirmed login could never sign in.
    email_confirm: true,
  });
  if (!created.ok) {
    const detail = (await created.json().catch(() => ({}))) as {
      error_code?: string;
      code?: string;
    };
    if (created.status === 422 || detail.error_code === 'email_exists') {
      throw new HttpError(400, 'USERNAME_TAKEN');
    }
    console.error('staff-admin: Auth create failed', created.status, detail);
    throw new HttpError(500, 'AUTH_ADMIN_FAILED');
  }
  const { id: userId } = (await created.json()) as { id: string };

  try {
    const result = await db<StaffResult>('staff_admin_create', {
      p_actor: actor,
      p_request_id: requestId,
      p_user_id: userId,
      p_username: args.username,
      p_full_name: fullName,
      p_phone: phone,
      p_role: staffRole,
    });
    return { ...result, temporary_password: password };
  } catch (error) {
    // No profile, no login: remove the login again so the username stays free.
    await authAdmin('DELETE', `/${userId}`);
    throw error;
  }
}

async function update(actor: string, requestId: string, input: Input) {
  return db<StaffResult>('staff_admin_update', {
    p_actor: actor,
    p_request_id: requestId,
    p_user_id: uuid(input, 'user_id'),
    p_full_name: text(input, 'full_name', true),
    p_phone: text(input, 'phone', false),
    p_role: role(input),
  });
}

async function setActive(actor: string, requestId: string, input: Input) {
  const isActive = input['is_active'];
  if (typeof isActive !== 'boolean') throw new HttpError(400, 'ACTIVE_REQUIRED');
  const result = await db<StaffResult>('staff_admin_set_active', {
    p_actor: actor,
    p_request_id: requestId,
    p_user_id: uuid(input, 'user_id'),
    p_is_active: isActive,
    p_reason: text(input, 'reason', false),
  });
  // Done again on a replay, so a retry finishes a ban that failed the first time.
  await updateLogin(result.staff.id, { ban_duration: isActive ? 'none' : BAN_FOREVER });
  return result;
}

async function resetPassword(actor: string, requestId: string, input: Input) {
  const result = await db<StaffResult>('staff_admin_password_reset', {
    p_actor: actor,
    p_request_id: requestId,
    p_user_id: uuid(input, 'user_id'),
  });
  const password = temporaryPassword();
  await updateLogin(result.staff.id, { password });
  return { ...result, temporary_password: password };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !allowedOrigins.includes(origin))
    return json({ error: 'NOT_AUTHORIZED' }, 403, null);
  if (request.method !== 'POST') return json({ error: 'BAD_REQUEST' }, 405, origin);

  try {
    if (!supabaseUrl || !serviceKey) throw new HttpError(500, 'AUTH_ADMIN_FAILED');
    const actor = await verifyAdmin(request);
    const input = (await request.json().catch(() => null)) as Input | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpError(400, 'BAD_REQUEST');
    }
    const requestId = input['request_id'];
    if (typeof requestId !== 'string' || !uuidPattern.test(requestId)) {
      throw new HttpError(400, 'REQUEST_ID_REQUIRED');
    }

    let result: unknown;
    switch (input['action']) {
      case 'create':
        result = await create(actor, requestId, input);
        break;
      case 'update':
        result = await update(actor, requestId, input);
        break;
      case 'set_active':
        result = await setActive(actor, requestId, input);
        break;
      case 'reset_password':
        result = await resetPassword(actor, requestId, input);
        break;
      default:
        throw new HttpError(400, 'BAD_REQUEST');
    }
    return json(result, 200, origin);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status, origin);
    console.error('staff-admin: unexpected error', error);
    return json({ error: 'AUTH_ADMIN_FAILED' }, 500, origin);
  }
});

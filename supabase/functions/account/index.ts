// account (S6, M1): a signed-in staff member changes their own password.
//
// Any active staff member may call it with their own access token, also while a temporary
// password is pending (that is what it is for). The service key exists only here.
//
//   1. Auth verifies the access token (GET /auth/v1/user); public.my_account() called with the
//      caller's token says the account is active. An Admin must be at aal2 (MFA) first.
//   2. A retried request id returns the stored result (account_password_replay): the old
//      password is not checked again after it has already been changed.
//   3. The new password follows the rules below; the current password is checked with Auth
//      (a password sign-in, which also counts towards Auth's rate limit on sign-ins).
//   4. Auth sets the new password through the person's own session (so it stays signed in);
//      account_password_changed (service_role) clears the temporary-password flag, audits it
//      and ends every other session.
//
// POST {"action": "change_password", "request_id", "current_password", "new_password"}
// Answers {"password_change": false, "sessions_revoked", "replayed"} or {"error": CODE}:
// NOT_SIGNED_IN (401), NOT_AUTHORIZED, MFA_REQUIRED (403), BAD_REQUEST, REQUEST_ID_REQUIRED,
// PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG, PASSWORD_SAME, PASSWORD_HAS_USERNAME,
// CURRENT_PASSWORD_WRONG (400), AUTH_ADMIN_FAILED (500).

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

/** The password rules (shown on the screen too): 10 to 72 characters (bcrypt's limit). */
const MIN_LENGTH = 10;
const MAX_LENGTH = 72;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The payload of a JWT that Auth has already verified. */
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

async function service<T>(fn: string, args: Record<string, unknown>): Promise<T> {
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
    console.error(`account: ${fn} failed`, response.status);
    throw new HttpError(500, 'AUTH_ADMIN_FAILED');
  }
  return body as T;
}

async function changePassword(token: string, input: Record<string, unknown>) {
  const requestId = input['request_id'];
  if (typeof requestId !== 'string' || !uuidPattern.test(requestId)) {
    throw new HttpError(400, 'REQUEST_ID_REQUIRED');
  }
  const current = input['current_password'];
  const next = input['new_password'];
  if (typeof current !== 'string' || typeof next !== 'string') {
    throw new HttpError(400, 'BAD_REQUEST');
  }

  // 1. Who is calling.
  const user = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!user.ok) throw new HttpError(401, 'NOT_SIGNED_IN');
  const { id, email } = (await user.json()) as { id?: string; email?: string };
  if (!id || !email) throw new HttpError(401, 'NOT_SIGNED_IN');
  const account = await fetch(`${supabaseUrl}/rest/v1/rpc/my_account`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const state = (account.ok ? await account.json() : null) as {
    active?: boolean;
    mfa_step?: boolean;
  } | null;
  if (!state?.active) throw new HttpError(403, 'NOT_AUTHORIZED');
  if (state.mfa_step) throw new HttpError(403, 'MFA_REQUIRED');

  // 2. A retry of a change that already happened.
  const replay = await service<unknown>('account_password_replay', {
    p_user_id: id,
    p_request_id: requestId,
  });
  if (replay) return replay;

  // 3. The rules, then the current password.
  const username = email.split('@')[0] ?? '';
  if ([...next].length < MIN_LENGTH) throw new HttpError(400, 'PASSWORD_TOO_SHORT');
  if (new TextEncoder().encode(next).length > MAX_LENGTH) {
    throw new HttpError(400, 'PASSWORD_TOO_LONG');
  }
  if (next === current) throw new HttpError(400, 'PASSWORD_SAME');
  if (username.length > 0 && next.toLowerCase().includes(username.toLowerCase())) {
    throw new HttpError(400, 'PASSWORD_HAS_USERNAME');
  }
  const check = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: current }),
  });
  if (!check.ok) throw new HttpError(400, 'CURRENT_PASSWORD_WRONG');

  // 4. Set it with the person's own session (the admin API would end every session, this one
  //    too), then clear the flag and end the other sessions; this one stays signed in.
  const set = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: next }),
  });
  if (!set.ok) {
    console.error('account: Auth update failed', set.status);
    throw new HttpError(500, 'AUTH_ADMIN_FAILED');
  }
  const session = claims(token)['session_id'];
  return service('account_password_changed', {
    p_user_id: id,
    p_request_id: requestId,
    p_keep_session: typeof session === 'string' && uuidPattern.test(session) ? session : null,
  });
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
    const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) throw new HttpError(401, 'NOT_SIGNED_IN');
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpError(400, 'BAD_REQUEST');
    }
    if (input['action'] !== 'change_password') throw new HttpError(400, 'BAD_REQUEST');
    return json(await changePassword(token, input), 200, origin);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status, origin);
    console.error('account: unexpected error');
    return json({ error: 'AUTH_ADMIN_FAILED' }, 500, origin);
  }
});

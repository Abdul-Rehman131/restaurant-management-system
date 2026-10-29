# Security review (end of P1, S6)

A review of the P1 system as built, against spec 7.4 and the hard rules in `CLAUDE.md`. Each
claim names the test or check that proves it. Run on the local stack on 29 Oct 2026; the
hosted-only items are marked **(hosted)** and are on the go-live checklist
([setup-checklist.md](setup-checklist.md) 6.1).

## 1. Database: RLS, grants, functions

**RLS is on for all 13 `public` tables** (audit_log, branches, categories, menu_items,
order_batches, order_counters, order_items, order_status_history, orders, payments, profiles,
restaurant_tables, settings). `order_counters` and `settings` have no policy at all: only
functions read them.

**Grants.** `anon` has no privilege on any table, column, sequence or function in `public`.
`authenticated` has `SELECT` only, and on chosen columns only: no INSERT, UPDATE or DELETE on
any table (hard rules 2 and 6). Hidden columns: `menu_items.cost_price`,
`order_items.cost_snapshot`, `profiles.phone`, `profiles.must_change_password`. Admins read
costs and phones through `admin_*` functions.

**Every write is a SECURITY DEFINER function** with `search_path = ''`: 34 granted to
`authenticated` and 9 to `service_role` only (the `staff_admin_*`, `account_password_*` and
`create_staff_profile` functions, called by the Edge Functions). `custom_access_token_hook` is
granted to `supabase_auth_admin`. Each `authenticated` function starts with
`private.require_role(...)`, which refuses (in this order) `NOT_AUTHORIZED`, `MFA_REQUIRED` and
`PASSWORD_CHANGE_REQUIRED`.

**`my_role()` is NULL** for an inactive profile, for a pending forced password change, and for
an Admin below aal2. Every RLS policy goes through `my_role()`, so such a token reads nothing
and can call nothing.

Proven by:
- `001_security_guards`: schema-wide guards. They fail on any table without RLS, any function
  without a fixed search_path, any function outside the allow-list, or any grant to `anon`.
  Probe tests show each guard catches a planted regression.
- `032_rls_select_matrix`: what each role reads, table by table.
- `035_role_scoped_rpcs`, `990_rpc_contracts`, and one file per function (110 to 410), with
  every role tried against every function.

## 2. Edge Functions (`staff-admin`, `account`)

| Check | How it is done | Proof |
|---|---|---|
| JWT verification | `verify_jwt = false` in `config.toml` (the gateway check would also block the CORS preflight), so each function verifies the caller itself with Auth's `GET /auth/v1/user`. A forged or expired token is refused 401. | e2e `admin.spec`, `account.spec` |
| Role and active state | `staff-admin`: the profile must be an active Admin. `account`: `my_account` with the caller's own token (inactive → `NOT_AUTHORIZED`). | pgTAP 380, 410; e2e |
| MFA | `staff-admin` requires `aal = aal2`. `account` refuses an Admin at aal1 (`MFA_REQUIRED`). | e2e `account.spec` (Admin: MFA step first), `admin.spec` |
| Stolen Admin token without aal2 | Refused everywhere. `staff-admin` 403 `MFA_REQUIRED`, every RPC `MFA_REQUIRED`, RLS reads return no rows (`my_role()` NULL), Storage upload refused (the policy checks `aal2`). | pgTAP 340 (`my_role()` NULL at aal1), 390; e2e `admin.spec` |
| CORS | Only the origins in `STAFF_APP_ORIGINS` get `Access-Control-Allow-Origin`. Any other browser origin is refused by the browser. Methods: POST, OPTIONS. | function code; set per environment (4.7) |
| Idempotency | `request_id` replay through `staff_admin_replay` / `account_password_replay`. | pgTAP 380, 410 |
| Rate limits | No limit inside the functions. Both need a signed-in caller (`staff-admin`: an Admin at aal2). `account` checks the current password with a password sign-in, so Auth's sign-in limit applies to guesses. | see section 4 |
| Secrets | The service-role key is read from the function environment only. The browser bundles hold only the publishable key (a gitleaks scan of `dist` finds only that, by design). | section 5 |

## 3. Storage and response headers

**Storage.** One bucket, `menu-images`: public read (menu photos are public), 1 MB limit, WebP
only. There are two policies, an Admin SELECT and an Admin INSERT. The INSERT needs aal2 and a
name matching `items/<uuid>.webp`. There is no UPDATE or DELETE policy: photos are never
overwritten or deleted (hard rule 6). Proof: pgTAP `390_menu_images_storage`.

**Headers** (`apps/staff-app/vercel.json`, all paths):
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy` (no camera, microphone or location)
- `Strict-Transport-Security` (2 years, subdomains), added in S6
- `Content-Security-Policy-Report-Only`, added in S6: self only, plus the Supabase project and
  the Sentry ingest host.

The CSP is report-only first so nothing breaks unnoticed. It is enforced (renamed to
`Content-Security-Policy`) after a staging check shows no violations in the browser console
(checklist 6.1). `customer-web` has the same base headers plus HSTS; its CSP comes in P2 with
the real site (Turnstile needs its own sources).

## 4. Sign-in protection

- **Per-IP limit (hosted):** Supabase Auth allows 30 sign-in attempts per 5 minutes per IP
  (`[auth.rate_limit] sign_in_sign_ups`). Then it answers 429, which the app shows as "Too many
  attempts. Wait a minute, then try again."
- **Local stack: not enforced.** 40 wrong sign-ins in a row all got 400, none 429, with or
  without an `X-Forwarded-For` header: the CLI's Auth container runs without the client-IP
  header the limiter needs. So the limit is **unproven locally** and must be checked once on
  staging (checklist 6.1, "Sign-in rate limits").
- **No per-account lockout.** Supabase Auth has none, and its password-verification hook is not
  on the Pro plan. Accepted for P1, because:
  - passwords have at least 10 characters (the `account` function and, since S6, Auth's own
    `minimum_password_length = 10`);
  - temporary passwords are 12 random characters and must be changed at first sign-in;
  - every Admin action also needs the authenticator code;
  - Leaked password protection is turned on at go-live **(hosted)**.
- **Side effect of the per-IP limit:** the whole restaurant shares one public IP. 30 wrong
  passwords in 5 minutes (for example a forgotten password typed again and again) block
  sign-ins for everyone there for up to 5 minutes. Staff who forget a password ask an Admin for
  a reset instead of retrying (the guides say so).

## 5. Secrets and the public repository

- **gitleaks 8.30.1** (the CI version, with `.gitleaks.toml`), full history: 136 commits with
  changes (153 including merges), **no leaks found**.
- The working folder scan finds 7 hits, all in git-ignored files:
  - `.env.local` (two, the local keys);
  - `supabase/.temp` (four, the local demo keys of the CLI);
  - `apps/staff-app/dist` (one, the publishable key in the build, public by design).
- CI runs the same scan on every push, and GitHub push protection is on.
- No staging or production key, database password or access token appears anywhere in the
  history (also checked in S5).

## 6. What is logged

| Where | What | Personal data |
|---|---|---|
| `public.audit_log` (written inside the database functions and triggers, Admin-only) | Cancellations, discounts, voids, price and settings changes, staff changes, password changes (event only), with user, time, reason, old and new value | Staff ids and names; never a password or token |
| Supabase Auth logs **(hosted)** | Sign-ins, failures, token refreshes, with IP | IPs and staff usernames; kept by Supabase per plan |
| Edge Function logs | Failed calls: function step, HTTP status, Auth's error text | No passwords, tokens or request bodies |
| Sentry (only if `VITE_SENTRY_DSN` is set) | Errors with stack, path and release | None: user, cookies, headers, bodies and query strings are removed before sending |
| Browser | Nothing persistent besides the session, cart and UI choices | |

## 7. Open risks

1. **Stolen session token can change the password.** Auth's "Secure password change" is off,
   so a stolen access or refresh token can set a new password through `PUT /auth/v1/user`
   without the current one. It has to stay off: staff have no real e-mail for re-authentication,
   and turning it on would break the `account` function for sessions older than 24 hours.
   Mitigations:
   - access tokens last 1 hour;
   - an Admin deactivates the person or resets the password, which ends all their sessions;
   - Admin tokens still need aal2.
2. **No per-account lockout** (section 4). Revisit if a hosted plan offers the hook.
3. **The restaurant shares one sign-in limit** (section 4).
4. **CSP is report-only** until the staging check.
5. **Sign-in limit, HSTS and CSP are not tested locally.** They are hosted or Vercel features:
   check them on staging.
6. **Realtime message limit.** 100 messages a second on the Free plan, 500 on Pro. A rush on
   many screens can be throttled; screens resync on reconnect, so nothing is lost, only late.
   See the load notes in [p1-acceptance.md](p1-acceptance.md).
7. **Edge Function sign-in guesses share the function's IP.** `account` checks the current
   password from Supabase's network. A signed-in staff member who keeps guessing could use up
   that IP's sign-in budget and delay other password changes for 5 minutes. Nobody's normal
   sign-in is affected.
8. **Deploy credentials in CI.** No service-role key is in CI. `db-deploy.yml` is the only
   workflow that uses secrets: a Supabase access token and the staging database password, both
   in the GitHub Environment `staging`, used on pushes to `develop`. The access token reaches
   every project in the Supabase account. Use a token from an account that only owns these
   projects, and rotate it if a maintainer leaves. Production deploys and Edge Functions are
   done by hand (checklist 4.7).

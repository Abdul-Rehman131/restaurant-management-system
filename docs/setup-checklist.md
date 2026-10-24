# Manual setup checklist

These are steps only the account owner can do. **The repository is public**: never paste a
password, key, token or connection string into chat, an issue, a PR or a committed file, and
keep private owner or business data out of the docs. Secrets live in the password manager
vault. They go into `.env.local` (on your machine), Vercel or GitHub Environment secrets.

Values that are *not* secret and are fine to share or commit: the GitHub repo URL, the Supabase
project **ref** (the `xxxx` in `https://xxxx.supabase.co`), the region, the Vercel project
names and domains, and the **publishable** key (`sb_publishable_...`, it ships in every browser
bundle). Secret: the DB password, the **secret** key (`sb_secret_...`) or service-role key, and
Supabase access tokens.

## 0. Your machine
- [x] Docker Desktop installed and working (needed for the local Supabase stack, T3).
- [x] `gh auth login` done.
- [ ] Optional: install the Supabase CLI globally. The repo pins it as a dev dependency (T3).

## 1. Password manager
- [ ] Create a shared vault for the project (1Password, Bitwarden or similar).
- [ ] Add the developers to it. All passwords and keys below go there, and nowhere else.

## 2. GitHub
Repo: https://github.com/Abdul-Rehman131/restaurant-management-system (public)
- [x] Repo created and pushed; PR #1 (T2) merged into `develop`.
- [x] Ruleset for `main` and `develop`: PR required, no force push or deletion.
- [x] `ci` is a required status check (T9).
- [x] Secret scanning and push protection enabled.
- [x] Environments `staging` and `production` created. `production` stays **empty** until go-live.
- [ ] Invite the developers as collaborators.

## 3. Supabase
**Staging** is the project `restaurant management system`, ref **`aqxmdmkforcucmktwmjj`**,
region **`ap-southeast-1` (Singapore)**.

- [ ] The staging DB password is in the vault. If it isn't known, reset it in Project Settings →
      Database and store the new one in the vault only.
- [x] Authentication → Sign In / Providers: "Allow new users to sign up" is off. Email stays enabled.
- [ ] Authentication → Multi-Factor: enable **TOTP**.
- [ ] Invite the developers to the org with the Developer role.

## 4. T10: staging deployment (in this order)

Both staging workflows (**DB deploy (staging)** and **Staging keep-alive**) stay **off** until
the repository variable `STAGING_DEPLOY_ENABLED` is `true`. Until then they show as *skipped*,
never failed, and nothing touches the staging project. Setting that variable is the **last**
setup step (4.5), after every secret and variable below exists.

### 4.1 GitHub: secrets and variables for the staging migrations
1. Supabase → your avatar → **Account preferences → Access Tokens → Generate new token**. Name
   it `github-actions-staging`, and pick an expiry (for example 90 days; note the date). Copy it
   once into the vault. Supabase tokens are per account, not per project: treat it like a password.
2. GitHub → repo → **Settings → Environments → `staging`**:
   1. **Deployment branches and tags** → **Selected branches and tags** → **Add deployment
      branch or tag rule** → `develop`. (Only `develop` can use these secrets.)
   2. **Environment secrets → Add environment secret**:
      - `SUPABASE_ACCESS_TOKEN`: the token from step 1.
      - `SUPABASE_DB_PASSWORD`: the staging DB password from the vault.
   3. **Environment variables → Add environment variable**:
      `SUPABASE_PROJECT_REF` = `aqxmdmkforcucmktwmjj`.
   4. No required reviewers on `staging`.
3. GitHub → repo → **Settings → Secrets and variables → Actions → Variables** tab →
   **New repository variable** (variables, **not** secrets; both values are public):
   - `STAGING_SUPABASE_URL` = `https://aqxmdmkforcucmktwmjj.supabase.co`
   - `STAGING_SUPABASE_PUBLISHABLE_KEY` = the staging **publishable** key (Supabase → Project
     Settings → API Keys → Publishable key, `sb_publishable_...`).
   - Do **not** add `STAGING_DEPLOY_ENABLED` yet (step 19).
4. Leave the `production` environment empty: no secrets, no variables.

### 4.2 Merge the T10 PR
5. The T10 PR can be merged into `develop` at any time. While `STAGING_DEPLOY_ENABLED` is not
   set, both staging workflows are skipped on that push.

### 4.3 Vercel (personal Hobby account, two projects)
Do this for each app. Values:

| | Staff app | Customer web |
|---|---|---|
| Project name | `rms-staff` | `rms-web` |
| Root Directory | `apps/staff-app` | `apps/customer-web` |
| `VITE_APP_NAME` | `Staff App (Staging)` | not used |

6. https://vercel.com/new → **Import Git Repository** → pick
   `Abdul-Rehman131/restaurant-management-system` (install the Vercel GitHub app for this repo
   only if asked).
7. **Project Name**: from the table. **Framework Preset**: Vite. **Root Directory** → Edit →
   pick the folder from the table → Continue.
8. **Build and Output Settings**: leave the defaults (Build Command `vite build` or
   `pnpm run build`, Output Directory `dist`, Install Command automatic: Vercel installs the
   pnpm workspace from the repo root).
9. **Environment Variables** (add each one):
   - `VITE_SUPABASE_URL` = `https://aqxmdmkforcucmktwmjj.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the staging **publishable** key. **Never** a secret or
     service-role key: the staff app refuses to start with one.
   - `VITE_APP_NAME` (staff app only) = `Staff App (Staging)`
   - `ENABLE_EXPERIMENTAL_COREPACK` = `1` (uses the exact pnpm version from `package.json`)
10. **Deploy**. The first build uses `main`, which is far behind; ignore that result.
11. Project → **Settings → Environments → Production → Branch Tracking**: change the branch to
    **`develop`** → Save. These Hobby projects are staging only, so their "Production" is the
    staging site and follows `develop`. Then **Deployments → Create Deployment** → `develop` → Create.
12. **Settings → Environment Variables**: check that each variable is ticked for **Production**
    and **Preview** (both point at staging; untick **Development**). PR previews use Preview, so
    they also use the staging backend.
13. **Settings → Build and Deployment → Node.js Version**: **24.x**.
14. **Settings → Git**: keep **Git Fork Protection** on (PRs from forks need your approval
    before they build).
15. **Settings → Deployment Protection**: leave **Vercel Authentication** on Standard
    Protection: PR previews need a Vercel login, while the staging domain itself stays open so
    staff phones can reach it (the app still requires a staff login).
16. Note the staging domains (Settings → Domains, for example `rms-staff-xxxx.vercel.app`) and
    send them to me. They are not secret.

### 4.4 Supabase staging: URL configuration
17. Authentication → **URL Configuration** → **Site URL** = the staff app staging domain from
    step 16. Nothing else is needed (staff log in with a password; there are no email links).

### 4.5 Turn on staging deploys (LAST setup step)
18. Check that steps 1–4 are done: the `staging` environment has its branch rule, both secrets
    and `SUPABASE_PROJECT_REF`, and both `STAGING_SUPABASE_*` repository variables exist.
19. GitHub → repo → **Settings → Secrets and variables → Actions → Variables** →
    **New repository variable**: `STAGING_DEPLOY_ENABLED` = `true` (exactly, lower case).
    Any other value, or deleting the variable, turns both workflows off again.
20. The next push to `develop` (for example the next merged PR) runs **DB deploy (staging)**:
    drift check, dry run, then the migrations. Both it and the next keep-alive run must be
    green. Changing a variable does not start a run by itself.

### 4.6 Supabase staging: after the first migration deploy
These need the database functions from the migrations, so they come after step 20.

21. Authentication → **Hooks** → **Customize Access Token (JWT) Claims** → enable → type
    **Postgres**, schema `public`, function **`custom_access_token_hook`** → Save. Without it,
    logins work but every user lands on "not available", and inactive staff are not refused at
    sign-in. (It is enabled locally in `supabase/config.toml`.)
22. Create the staging staff accounts on **your** machine, in PowerShell from the repo folder:
    ```powershell
    $env:SUPABASE_SECRET_KEY = Read-Host -MaskInput 'Staging secret key'
    pnpm seed:staging
    Remove-Item Env:SUPABASE_SECRET_KEY
    ```
    Paste the staging **secret** key (Project Settings → API Keys → Secret keys) at the prompt.
    It is not echoed and not saved in the shell history. The script creates `admin`, `cashier`,
    `waiter` and `chef` with confirmed `@staff.invalid` logins and prints each new password
    **once**: put them in the vault, then `Clear-Host`. Running it again skips existing accounts.

## 5. Sentry (postponed to T11)
Nothing to do now. In T11: create an organisation and two React projects (`rms-staff`,
`rms-web`), invite the developers, and put the DSNs into env vars only.

## 6. Before go-live (production is deferred)
Nothing here is built yet. There is no production project, workflow, secret or deploy job.

- [ ] **Hosting decision (D14).** Vercel Hobby is for non-commercial use only, so the live
      restaurant cannot run on it. Choose **Vercel Pro** (a client-owned team, about USD 20
      per member per month) or **Cloudflare Pages** (free). Create the production front-end
      projects there; the Hobby projects stay staging only.
- [ ] **Supabase `rms-prod`**: same org, region **`ap-southeast-1` (Singapore)**, its **own**
      DB password (vault only), "Allow new users to sign up" **off**, TOTP on, and the access
      token hook enabled after the first migration deploy. Upgrade to **Pro** (no inactivity
      pause, daily backups) and test a restore.
- [ ] **GitHub environment `production`**: deployment branch `main` only, **you as required
      reviewer**, secrets `SUPABASE_ACCESS_TOKEN` (a separate token) and
      `SUPABASE_DB_PASSWORD` (the production one), variable `SUPABASE_PROJECT_REF`.
- [ ] **A db-deploy job for `main`**: the same steps as staging (drift check, dry run, push),
      gated by the `production` environment so every deploy waits for your approval.
- [ ] **Front-end production settings**: production branch `main`, the production Supabase URL
      and publishable key for the Production environment only, `VITE_APP_NAME`, the custom
      domain (D12), and remove `"main": false` from `git.deploymentEnabled` in both
      `vercel.json` files.
- [ ] Real staff accounts are created by the Admin in the app (P1), never by `seed:staging`;
      production never gets demo data.
- [ ] Update the README rollback section with the production steps.

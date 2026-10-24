# T1 manual setup checklist

These are steps only the account owner can do. **The repository is public**: never paste a
password, key, token or connection string into chat, an issue, a PR or a committed file, and
keep private owner or business data out of the docs. Secrets live in the password manager
vault. They go into `.env.local` (on your machine), Vercel or GitHub Environments later (T10).

Values that are *not* secret and are fine to share or commit: the GitHub repo URL, the Supabase
project **ref** (the `xxxx` in `https://xxxx.supabase.co`), the region, and the Vercel and Sentry org slugs.

## 0. Your machine
- [x] Docker Desktop installed and working (needed for the local Supabase stack, T3).
- [ ] Run `gh auth login` in a terminal (browser login). Nothing to paste here.
- [ ] Optional: install the Supabase CLI globally. The repo pins it as a dev dependency (T3).

## 1. Password manager
- [ ] Create a shared vault for the project (1Password, Bitwarden or similar).
- [ ] Add the developers to it. All passwords and keys below go there, and nowhere else.

## 2. GitHub
Repo: https://github.com/Abdul-Rehman131/restaurant-management-system (public)
- [x] Repo created and pushed; PR #1 (T2) merged into `develop`.
- [x] Ruleset for `main` and `develop`: PR required, no force push or deletion.
- [ ] Add the `ci` check as a required status check once T9 exists.
- [x] Secret scanning and push protection enabled.
- [x] Environments `staging` and `production` created. On `production`, make sure you are a
      required reviewer. Secrets are added in T10.
- [ ] Invite the developers as collaborators.

## 3. Supabase
**Staging** is the project `restaurant management system`, ref **`aqxmdmkforcucmktwmjj`**,
region **`ap-southeast-1` (Singapore)**. The old Sydney project is deleted.

- [ ] Make sure the staging DB password is in the vault. If it isn't known, reset it in Project
      Settings → Database and store the new one in the vault only.
- [x] Staging → Authentication → Sign In / Providers: "Allow new users to sign up" is off. Email stays enabled.
- [ ] Staging → Authentication → Multi-Factor: enable **TOTP**.
- [ ] Staging → Authentication → URL Configuration: leave as is for now (set in T10 once the Vercel domains exist).
- [ ] **At T10, after the migrations are deployed:** Staging → Authentication → Hooks → enable
      **Customize Access Token (JWT) Claims** with the Postgres function
      `public.custom_access_token_hook`. It is enabled locally in `supabase/config.toml`. Without
      it, logins work but the app cannot route staff to their screen.
- [ ] Invite the developers to the org with the Developer role.

**Production (`rms-prod`) is created in T10, not now.** Same org, same region
(`ap-southeast-1`), a **different** DB password, and the same Authentication settings as staging.

## 4. Vercel
- [ ] Create a team (client-owned). Hobby is fine for development; Pro is needed before go-live (D14).
- [ ] Invite the developers. **Don't import the repo yet**; the projects are created in T10.
- [ ] At T10, set **`VITE_APP_NAME`** on each staff-app deployment (Vercel → Project →
      Environment Variables). It is the install label on the home screen and defaults to
      "Staff App". It is not a secret. The name shown inside the app always comes from the
      settings table.

## 5. Sentry (postponed to T11)
Nothing to do now. In T11: create an organisation and two React projects (`rms-staff`,
`rms-web`), invite the developers, and put the DSNs into env vars only.

## 6. Still needed from you
Before T10, send me the Vercel team slug. **Never send keys or passwords.**

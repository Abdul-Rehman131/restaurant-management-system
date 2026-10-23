# T1 manual setup checklist

These are steps only the account owner can do. **Never paste a password, key, token or
connection string into chat, an issue, or a committed file.** Store them in the password
manager vault. They go into `.env.local` (on your machine), Vercel or GitHub Environments
later (T10).

Values that are *not* secret and are fine to share or commit: GitHub repo URL, Supabase
project **ref** (the `xxxx` in `https://xxxx.supabase.co`), region, Vercel and Sentry org slugs.

## 0. Your machine
- [ ] Install **Docker Desktop** (with the WSL 2 backend on Windows) and start it. This is needed for the local Supabase stack in T3.
- [ ] Run `gh auth login` in a terminal (browser login). Nothing to paste here.
- [ ] Optional: install the Supabase CLI globally. The repo also pins it as a dev dependency in T3.

## 1. Password manager
- [ ] Create a shared vault named "Ember Kitchen RMS" (1Password, Bitwarden or similar).
- [ ] Add the developers to it. All passwords and keys below go there, and nowhere else.

## 2. GitHub
- [ ] Decide on the owner: a client organisation (recommended) or a personal account (open question Q2).
- [ ] Create an **empty private** repo, for example `ember-kitchen-rms`. Add no README, licence or .gitignore, because the local repo already has commits.
- [ ] Push the local repo (I can run this for you once you tell me the repo URL):
      `git remote add origin <url>`, then `git push -u origin main develop`.
- [ ] Settings → General: default branch `develop`. Allow **squash merge** for PRs; keep merge commits allowed for releases.
- [ ] Settings → Rules → Rulesets: add a ruleset for `main` and `develop`:
      - require a pull request (1 approval)
      - block force pushes and deletion
      - require status checks (add the `ci` check after T9 exists)
- [ ] Settings → Environments: create `staging` and `production`. On `production`, add yourself as a required reviewer. Secrets are added in T10.
- [ ] Invite the developers as collaborators.

## 3. Supabase
- [ ] Create an organisation (client-owned).
- [ ] Create the project `rms-staging`, choosing the region closest to the restaurant (for example `ap-south-1` Mumbai). Generate a strong DB password and save it in the vault.
- [ ] Create the project `rms-prod` the same way, with a **different** password.
- [ ] In **both** projects:
  - [ ] Authentication → Sign In / Providers: **turn off "Allow new users to sign up"**. Keep Email enabled.
  - [ ] Authentication → Multi-Factor: enable **TOTP**.
  - [ ] Authentication → URL Configuration: leave as is for now (set in T10 once the Vercel domains exist).
- [ ] Invite the developers to the org with the Developer role.
- [ ] Note the two **project refs** (not secret) for the README.

## 4. Vercel
- [ ] Create a team (client-owned). Hobby is fine for development; Pro is needed before go-live (D14).
- [ ] Invite the developers. **Don't import the repo yet**; the projects are created in T10.

## 5. Sentry
- [ ] Create an organisation and two projects, platform *React*: `rms-staff` and `rms-web`.
- [ ] Invite the developers. The DSNs are not highly sensitive, but they still go into env vars only (T11).

## 6. Tell me when done
Just reply with: the GitHub repo URL, the two Supabase project refs and the region, and the
Vercel and Sentry org slugs. **No keys or passwords.**

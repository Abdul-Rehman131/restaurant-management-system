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
**Staging** is your existing project, **`restaurant management system`**, in region
**`ap-southeast-2` (Sydney)**. Keep its name and region as they are, and don't create another
staging project.

- [ ] Make sure the staging DB password is in the vault. If it isn't known, reset it in Project
      Settings → Database and store the new one in the vault only.
- [ ] Staging → Authentication → Sign In / Providers: **turn off "Allow new users to sign up"**. Keep Email enabled.
- [ ] Staging → Authentication → Multi-Factor: enable **TOTP**.
- [ ] Staging → Authentication → URL Configuration: leave as is for now (set in T10 once the Vercel domains exist).
- [ ] Invite the developers to the org with the Developer role.
- [ ] Note the staging **project ref** (not secret) for the README.

**Production (`rms-prod`) is created in T10, not now.** At that point: same org, a region
decision (staying in `ap-southeast-2`, the same region as staging, keeps behaviour identical), a **different** DB
password, then the same three Authentication settings as staging.

## 4. Vercel
- [ ] Create a team (client-owned). Hobby is fine for development; Pro is needed before go-live (D14).
- [ ] Invite the developers. **Don't import the repo yet**; the projects are created in T10.
- [ ] At T10, set **`VITE_APP_NAME`** on each staff-app deployment (Vercel → Project →
      Environment Variables). It is the install label on the home screen, and defaults to
      "Staff App". It is not a secret. The name shown inside the app always comes from the
      settings table.

## 5. Sentry (postponed to T11)
Nothing to do now. In T11: create an organisation and two React projects (`rms-staff`,
`rms-web`), invite the developers, and put the DSNs into env vars only.

## 6. Tell me when done
Before T3, I need **Docker running** and the **GitHub repo** created. Reply with the GitHub repo
URL, the staging project ref and the Vercel org slug. **No keys or passwords.**

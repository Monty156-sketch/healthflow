# HealthFlow

A staff duty-rostering and labour-compliance system for Ghana Health Service
facilities — built fresh, to replace the pilot's current Base44 deployment
once it looks and performs better. Base44 stays live until that cutover;
nothing here touches it.

This is **Phase 0**: the foundation. A monorepo, the full database schema,
and a working authentication system (login, MFA, 30-minute idle sessions,
instant revocation on deactivation). No roster screens yet — those are
Phase 1 onward, built the same way, step by step.

## Stack, and why

| Layer | Choice | Why |
|---|---|---|
| Database | PostgreSQL on [Neon](https://neon.tech) | Free tier, serverless, as requested |
| ORM | Prisma | Type-safe queries matching the 44-model schema in `packages/db` |
| API | Express on Node, hosted on [Render](https://render.com) (free tier) | Roster generation runs as a long background job — a serverless function would time out or cold-start mid-job. Render's free tier runs a persistent Node process |
| Frontend | Next.js 16 (App Router), hosted on [Cloudflare Workers](https://workers.cloudflare.com) (free plan) via the OpenNext adapter | Fast global edge delivery, 100,000 free requests a day. It also forwards `/api/*` to Render so the session cookie stays first-party (see Security) |
| Auth | JWT access tokens (15 min) + DB-backed refresh tokens (30 min idle timeout) | Explained in full below |

Everything free-tier. The only things you pay for, ever, are a domain name
(if you want one later) and, eventually, outgrowing the free tiers.

## Security

- **Passwords**: Argon2id (OWASP-recommended parameters), never stored in any
  reversible form.
- **Sessions**: a JWT access token (15 minutes, kept in memory in the
  browser tab, never in localStorage) paired with an opaque refresh token
  stored as a hashed row in the database, set as an httpOnly/Secure cookie.
  The refresh token's row tracks `lastUsedAt`: if it's been more than 30
  minutes since the last request, the session is dead, even though the
  token itself would still technically be valid for 30 days. This is what
  "30-minute session" means in practice — 30 minutes of *inactivity* logs
  you out, not 30 minutes from login.
- **Instant revocation**: because refresh tokens are rows in the database
  rather than just a signature, deactivating a staff account (or an admin
  forcing "log out everywhere") deletes those rows immediately. A plain JWT
  scheme can't do this — a signed token stays valid until it expires no
  matter what you do to the account behind it.
- **MFA**: TOTP (works with any authenticator app), mandatory for Facility
  Admins, District Officers, and Platform Admins. Ten single-use recovery
  codes are issued at setup, stored as hashes.
- **Account lockout**: 5 failed logins locks the account for 15 minutes.
- **Scope enforcement**: every request is checked server-side against the
  caller's facility/district/platform scope — the frontend's own filtering
  is never trusted.
- **Audit log**: every sensitive action is recorded, with sensitive fields
  redacted before they're written.
- **Rate limiting**: tight limits on auth endpoints, looser general limits
  elsewhere, counted per real visitor IP.
- **One domain for the browser**: the frontend forwards every `/api/*`
  request to the Render API (`apps/web/src/app/api/[...path]/route.ts`), so
  the browser only ever talks to the frontend's domain. That keeps the
  refresh cookie first-party; browsers block third-party cookies, which
  would sign users out on every refresh. The proxy passes the visitor's IP
  along with a shared secret (`PROXY_SHARED_SECRET`), and the API trusts that
  IP only when the secret matches.

## Project layout

```
apps/
  web/     Next.js frontend
  api/     Express backend
packages/
  db/      Prisma schema + migrations + seed data
  shared/  Constants and types shared by both apps
```

## Local development

You'll need Node 20+, pnpm, and a Neon database.

```bash
pnpm install

# copy the env templates and fill in real values
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

pnpm db:generate     # generates the Prisma client
pnpm db:migrate      # creates the tables in your Neon database
pnpm db:seed         # creates the facility and the first accounts (see below)

pnpm dev:api         # http://localhost:4000
pnpm dev:web         # http://localhost:3000
```

### Accounts from the seed script

`pnpm db:seed` creates what is missing and leaves everything else alone, so
it is safe to run again. Set these in `packages/db/.env`:

| Setting | What it does |
|---|---|
| `MFA_ENCRYPTION_KEY` | Must be the live API's key. The seed prints a fingerprint; it must match the one in Render's logs. |
| `SEED_ADMIN_PASSWORD` | Password for the platform admin (`admin@healthflow.app`), used only when that account is created or reset. |
| `SEED_FACILITY_ADMIN_EMAIL` | Creates a facility admin for Sombo, the account that uses the facility screens. |
| `SEED_FACILITY_ADMIN_NAME` | Their full name, as audit entries will show it. |
| `SEED_FACILITY_ADMIN_PASSWORD` | Their password, used only when the account is created or reset. |
| `SEED_RESET_ACCOUNTS` | Optional, comma-separated emails whose password and authenticator should be replaced. |

A new account gets two-step sign-in already set up: the seed prints its
authenticator key and recovery codes once. Keep the recovery codes private.

The platform admin does not see facility data. Under the spec, PS Tech
reaches a facility only through a logged, time-limited support session,
which arrives with the platform console. Use the facility admin account for
the facility screens.

### Email (optional for now)

Password-reset emails go out through a Gmail account you own (free, no domain
needed; setup is in `RUNBOOK.md`, "Email") or through [Resend](https://resend.com)
when `RESEND_API_KEY` and `EMAIL_FROM` are set on the API (Render). Without either,
"Forgot your password?" still answers normally but sends nothing, and the
person asks their facility admin, who can create a one-use reset link from
the staff member's page. Resend's free plan covers this volume but needs a
domain you own to send from.

### Tests

`pnpm --filter @healthflow/api test` runs the API's integration tests. They
need `DATABASE_URL` pointing at a disposable Postgres database, never Neon:
each test empties the database. CI runs them against a fresh Postgres on
every push.

## Connecting the three free services

### 1. Neon (database)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **pooled connection string** (not the direct one — Render's free
   tier and serverless-style connections both do better behind Neon's
   pooler) into `DATABASE_URL`, both in `apps/api/.env` locally and later in
   the Render dashboard.
3. Run `pnpm db:migrate` once, from your machine, to create the tables.

### 2. Render (backend API)

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, point it at the repo. It
   reads `render.yaml` at the root and creates the `healthflow-api` service:
   build command, start command, Node version and health check are all set.
3. Fill in the environment variables marked `sync: false` in `render.yaml`:
   - `DATABASE_URL`: the Neon pooled connection string
   - `MFA_ENCRYPTION_KEY`: the same value as in your local `apps/api/.env`
     (local and live share one database, so they must share this key)
   - `PROXY_SHARED_SECRET`: the same value as in your local `apps/api/.env`;
     you will also give it to Cloudflare in step 3
   - `WEB_ORIGIN`: the frontend URL, once you have it from step 3
   - `GMAIL_*` or `RESEND_API_KEY` and `EMAIL_FROM`: can stay empty until email is set up
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_PEPPER` are generated by Render.
4. Deploy. Render gives you a URL like `https://healthflow-api-xxxx.onrender.com`.
   Put it in `apps/web/wrangler.jsonc` under `vars.API_ORIGIN`.

**Free-tier caveat**: Render's free web services sleep after 15 minutes of
no traffic and take 30-60 seconds to wake up on the next request. The
`.github/workflows/keep-awake.yml` workflow pings the health endpoint every
10 minutes to keep it warm. Set a repo variable named `RENDER_API_URL` to
your service's base URL (Settings → Secrets and variables → Actions →
Variables) and it starts working automatically.

### 3. Cloudflare Workers (frontend)

The frontend runs as a Cloudflare **Worker**, not a Pages site: the OpenNext
adapter (`@opennextjs/cloudflare`) targets Workers, and only a Worker can run
the server-side code the `/api` proxy needs. Both live under the same
"Workers & Pages" section of the dashboard and both are free.

1. In the Cloudflare dashboard: **Workers & Pages → Create → Import a
   repository**, pick this repo, and set:
   - **Project name**: `healthflow` (must match `name` in `apps/web/wrangler.jsonc`)
   - **Root directory**: leave as `/` (the repo root, where the lockfile is)
   - **Build command**: `pnpm --filter @healthflow/web cf:build`
   - **Deploy command**: `pnpm --filter @healthflow/web cf:deploy`
2. Deploy. Cloudflare gives you a URL like
   `https://healthflow.YOUR-SUBDOMAIN.workers.dev`.
3. Open the Worker → **Settings → Variables and Secrets → Add**, type
   **Secret**, name `PROXY_SHARED_SECRET`, same value as on Render.
4. Back on Render, set `WEB_ORIGIN` to the workers.dev URL.

You can also deploy from your own machine instead of connecting Git:
`pnpm --filter @healthflow/web cf:build && pnpm --filter @healthflow/web cf:deploy`
(needs `npx wrangler login` once).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and tests on every push and
pull request against `main`. Render and Cloudflare redeploy on their
own when `main` changes (that's configured in their own dashboards, not
here) — this workflow is the gate that runs first.

## What's next

Phase 0 proves the pipeline end to end: a real database, a real login, a
real session. Phase 1 starts building the screens staff and admins will
actually use — staff records, shift templates, leave requests — against
this same foundation, one phase at a time, exactly as laid out in the
architecture doc.

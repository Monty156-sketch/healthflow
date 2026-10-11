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
| Frontend | Next.js 16 (App Router), hosted on [Cloudflare Pages](https://pages.cloudflare.com) (free tier) | Fast global edge delivery, generous free tier, via the OpenNext adapter |
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
  elsewhere.

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
pnpm db:seed         # creates one facility + one platform admin to log in with

pnpm dev:api         # http://localhost:4000
pnpm dev:web         # http://localhost:3000
```

`pnpm db:seed` prints the admin login it creates — use that to sign in at
`/login` on the web app.

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
   reads `render.yaml` at the root and creates the `healthflow-api` service
   automatically — build command, start command, and health check are all
   already set.
3. Render will ask you to fill in the environment variables marked
   `sync: false` in `render.yaml`:
   - `DATABASE_URL` — the Neon pooled connection string
   - `WEB_ORIGIN` — the Cloudflare Pages URL once you have it (step 3), e.g.
     `https://healthflow.pages.dev`
   - `RESEND_API_KEY`, `EMAIL_FROM` — for sending verification/notification
     emails (a free [Resend](https://resend.com) account covers this)
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER`, `MFA_ENCRYPTION_KEY` are
     marked `generateValue: true` — Render generates strong random values
     for these itself, so leave them.
4. Deploy. Render gives you a URL like `https://healthflow-api.onrender.com`
   — that's your `NEXT_PUBLIC_API_BASE` for the frontend.

**Free-tier caveat**: Render's free web services sleep after 15 minutes of
no traffic and take 30-60 seconds to wake up on the next request. The
`.github/workflows/keep-awake.yml` workflow pings the health endpoint every
10 minutes to keep it warm — set a repo variable named `RENDER_API_URL` to
your service's base URL (Settings → Secrets and variables → Actions →
Variables) once it exists, and it starts working automatically.

### 3. Cloudflare Pages (frontend)

The adapter that makes a Next.js app deployable to Cloudflare's Workers
runtime is `@opennextjs/cloudflare`, already wired into
`apps/web/package.json` and `apps/web/open-next.config.ts`.

1. `pnpm install` (if you haven't already — this pulls in `wrangler` and
   `@opennextjs/cloudflare`).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git**, point it at this repo, and set:
   - **Root directory**: `apps/web`
   - **Build command**: `cd ../.. && npm install -g pnpm && pnpm install --frozen-lockfile && pnpm --filter @healthflow/web cf:build`
   - **Build output directory**: `.open-next/assets`
3. Add an environment variable in the Pages project settings:
   `NEXT_PUBLIC_API_BASE` = your Render API URL from step 2.
4. Deploy. Cloudflare gives you a URL like `https://healthflow.pages.dev`.
5. Go back to Render and set `WEB_ORIGIN` to that URL (the API only accepts
   cookies from an origin it's explicitly told to trust).

You can also deploy from your own machine instead of connecting Git:
`pnpm --filter @healthflow/web cf:deploy` (needs `wrangler login` once).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and tests on every push and
pull request against `main`. Render and Cloudflare Pages redeploy on their
own when `main` changes (that's configured in their own dashboards, not
here) — this workflow is the gate that runs first.

## What's next

Phase 0 proves the pipeline end to end: a real database, a real login, a
real session. Phase 1 starts building the screens staff and admins will
actually use — staff records, shift templates, leave requests — against
this same foundation, one phase at a time, exactly as laid out in the
architecture doc.

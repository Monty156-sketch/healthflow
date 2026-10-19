# HealthFlow runbook

For the person on call. It says where things run, how to put them back, and what never to change.

## Where things run

| Part | Host | Notes |
| --- | --- | --- |
| Website (Next.js) | Cloudflare Workers | Deploys from `main` through Workers Builds. `/api/*` is forwarded to the API by the Worker. |
| API (Express) | Render | `render.yaml`. Health check: `/health`. Runs the scheduler (support expiry, overdue invoices, retention). |
| Database | Neon (Postgres) | Migrations run with `pnpm --filter @healthflow/db migrate:deploy`. |
| Email | Resend | Needs `RESEND_API_KEY` and `EMAIL_FROM`. |
| Card and mobile money | Paystack | Needs `PAYSTACK_SECRET_KEY` and the webhook `https://<api>/api/webhooks/paystack`. |
| SMS | Arkesel | Needs `SMS_API_KEY` and `SMS_SENDER_ID`. Off until a facility turns it on. |

## Deploying and rolling back

1. Every change goes through a pull request. `lint-typecheck-test` must pass before merge.
2. Merging to `main` deploys the website and the API. Check `/version` (website) and `/health` (API) show the new commit.
3. To roll back, revert the pull request on GitHub. Never edit `main` by hand.
4. A migration is not undone by a revert. Write a new migration that undoes it, and only if no data depends on it.

## Never change these without a plan

- **`MFA_ENCRYPTION_KEY`.** Every authenticator secret is encrypted with it. A different key makes every administrator's two-step sign-in unreadable and locks them out. Local development and production share one Neon database today, so the key must be the same in both.
- **`JWT_REFRESH_PEPPER` / `JWT_ACCESS_SECRET`.** Changing them signs everyone out. That is the way to force a sign-out after a suspected leak, and loses no data.
- **`PROXY_SHARED_SECRET`.** Must be identical on Render and Cloudflare, or the API cannot trust visitor IPs and rate limits misbehave.

## Backups and restore

- The database is the only thing that holds state. The API and the website can be rebuilt from Git.
- Neon keeps point-in-time history for the window your plan allows. Check the window in the Neon console and write it on the Security page only when it is confirmed.
- To restore: in Neon, create a branch from a point in time before the damage, check the data on that branch, then either point `DATABASE_URL` on Render at the branch or copy the affected tables back. Do the restore on a branch first. Never restore over the live database without a branch to compare.
- Once a month, export a copy: `pg_dump "$DATABASE_URL" > healthflow-YYYY-MM.sql`, and keep it somewhere that is not Neon.
- Practise a restore at least once before a facility depends on it.

## When something is wrong

1. Open Platform, System health: failed jobs, error reports, and the last scheduler runs.
2. Sign-in problems for one person: Platform, Users. A locked account frees itself after 15 minutes.
3. Everyone signed out suddenly: a secret changed. Check Render's environment history.
4. Error 1102 on the website: Cloudflare's CPU limit. The `/api/*` forward exists to avoid it. If it returns, check the Workers plan.
5. Payments not marking as paid: check the Paystack webhook delivery log first, then Platform, Billing.

## A data breach

The Terms and the Data Processing Agreement promise facilities notice within 48 hours. In that time:

1. Stop the cause: rotate the secrets above, end sessions, suspend the account involved.
2. Work out which facilities and which people's data were touched. The audit log is the record.
3. Tell each affected facility's data protection contact in writing, and the Data Protection Commission where the law requires it.
4. Write down what happened, what was done and what changes.

## Known limits

- One API instance, one database. A restart interrupts requests for a moment.
- Local development and production share one database. A staging database would remove that risk.
- The website's Content Security Policy does not yet restrict scripts and styles. That needs a nonce on every page.
- `pnpm audit` reports one high advisory, in a package the Prisma command line uses while migrating. It is not loaded by the running API or website.

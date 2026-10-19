# HealthFlow runbook

For the person on call. It says where things run, how to put them back, and what never to change.

## Where things run

| Part | Host | Notes |
| --- | --- | --- |
| Website (Next.js) | Cloudflare Workers | Deploys from `main` through Workers Builds. `/api/*` is forwarded to the API by the Worker. |
| API (Express) | Render | `render.yaml`. Health check: `/health`. Runs the scheduler (support expiry, overdue invoices, retention). |
| Database | Neon (Postgres) | Migrations run with `pnpm --filter @healthflow/db migrate:deploy`. |
| Email | Gmail, or Resend | Gmail needs no domain. See "Email" below. |
| Card and mobile money | Paystack | Needs `PAYSTACK_SECRET_KEY` and the webhook `https://<api>/api/webhooks/paystack`. |
| SMS | Arkesel, or SMS Gateway for Android | See "Text messages" below. Off until a facility turns it on. |

## Deploying and rolling back

1. Every change goes through a pull request. `lint-typecheck-test` must pass before merge.
2. Merging to `main` deploys the website and the API. Check `/version` (website) and `/health` (API) show the new commit.
3. To roll back, revert the pull request on GitHub. Never edit `main` by hand.
4. A migration is not undone by a revert. Write a new migration that undoes it, and only if no data depends on it.

## Never change these without a plan

- **`MFA_ENCRYPTION_KEY`.** Every authenticator secret is encrypted with it. A different key makes every administrator's two-step sign-in unreadable and locks them out. Local development and production share one Neon database today, so the key must be the same in both.
- **`JWT_REFRESH_PEPPER` / `JWT_ACCESS_SECRET`.** Changing them signs everyone out. That is the way to force a sign-out after a suspected leak, and loses no data.
- **`PROXY_SHARED_SECRET`.** Must be identical on Render and Cloudflare, or the API cannot trust visitor IPs and rate limits misbehave.

## Email

Used for password resets and for the "new facility registered" alert to PS Tech. Nothing else depends on it.

**Gmail (free, no domain).** The API sends as a Gmail account you own, through Google's web API. It does not use SMTP, which Render's free plan blocks. Gmail allows about 500 recipients a day, which is plenty for this. Use a Gmail account made for HealthFlow if you can, because sent mail appears in its Sent folder.

1. Sign in to <https://console.cloud.google.com> with that Gmail account. Create a project named HealthFlow.
2. **APIs & Services, Library**: search for Gmail API and press Enable.
3. **OAuth consent screen** (Google Auth Platform): choose External, name the app HealthFlow, give your email for support and contact. Add the Gmail account as a test user. Then set the publishing status to **In production**. This matters: while an app is left in Testing, Google ends its refresh token after 7 days and email stops. The "unverified app" warning that follows is expected for your own account.
4. **Credentials, Create credentials, OAuth client ID**: type Web application. Under authorized redirect URIs add `https://developers.google.com/oauthplayground`. Copy the client ID and client secret.
5. Open <https://developers.google.com/oauthplayground>. Click the gear, tick **Use your own OAuth credentials**, and paste the client ID and secret. In step 1 type the scope `https://www.googleapis.com/auth/gmail.send` and press Authorize APIs. Sign in with the Gmail account, press Advanced, then continue to the app, and allow it. In step 2 press **Exchange authorization code for tokens** and copy the **Refresh token**.
6. On Render, healthflow-api, Environment, set `GMAIL_USER` (the address), `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`. Save and wait for the deploy.
7. Test: register a test facility, or ask for a password reset for a real address. PS Tech's alert goes to `ACCESS_REQUEST_NOTIFY`.

If email stops working, the usual cause is that Google ended the refresh token (the app was in Testing, the Gmail password was changed, or access was removed at <https://myaccount.google.com/permissions>). Repeat step 5 and replace `GMAIL_REFRESH_TOKEN`. The Render log line is "Google refused the sign-in".

**Resend.** Needs a domain you own. Set `RESEND_API_KEY` and `EMAIL_FROM`. Gmail wins if both are set.

## Backups and restore

- The database is the only thing that holds state. The API and the website can be rebuilt from Git.
- Two copies exist. Neon keeps point-in-time history for the window your plan allows (check it in the Neon console). And `.github/workflows/backup.yml` makes an encrypted export every Sunday, kept 30 days on the workflow run page.
- The export needs two repository secrets: `BACKUP_DATABASE_URL` (Neon direct connection, a read-only role is best) and `BACKUP_PASSPHRASE`. Keep the passphrase somewhere outside GitHub as well. Without it the copies cannot be read. Until both are set the weekly run fails on purpose.
- Make one by hand: `DATABASE_URL=... BACKUP_PASSPHRASE=... scripts/backup.sh ./exports`. It checks that the copy can be listed before it reports success.
- To restore from Neon history: in Neon, create a branch from a point in time before the damage, check the data on that branch, then either point `DATABASE_URL` on Render at the branch or copy the affected tables back. Never restore over the live database without a branch to compare.
- To restore from an export: `gpg -d healthflow-DATE.dump.gpg | pg_restore --no-owner -d <NEW_EMPTY_DATABASE_URL>`. Restore into a new database first, check it, then switch.
- No restore has been practised yet. Do one into a Neon branch before a facility depends on this, and write the date here.

## Text messages

There is no free bulk SMS service in Ghana that is fit for a live system. Two ways to start at little or no cost:

1. **Your own phone as the gateway (free software).** Install SMS Gateway for Android (open source, Apache 2.0, from github.com/capcom6/android-sms-gateway) on an Android phone with a SIM and airtime or a bundle. Turn on "Cloud Server" in the app and note the username and password it shows. On Render set `SMS_PROVIDER=sms-gate`, `SMS_GATE_USER` and `SMS_GATE_PASSWORD`. Texts leave from that SIM at its normal tariff. The phone must stay on, charged and online. The project warns that carriers may restrict batch sending, so this suits a few hundred texts a day, not more. Its default build allows cleartext traffic, so keep that phone for this job only.
2. **Arkesel (paid after a few free test texts).** Sign up at arkesel.com, register a sender ID (no fee, reviewed before use), and set `SMS_API_KEY` and `SMS_SENDER_ID`. Arkesel advertises free test credits on signup; the amount is on their pricing page.

Either way, prove it: after setting the variables, a facility administrator opens Staff, Text messages, types a number and presses "Send test text". The test and its result are recorded.

## Staging and safe databases

Local development, the tests and production used to share one database. Three guards now stop that:

- `pnpm test` refuses to start unless the database is on this computer or its name contains `test`. The tests delete every row.
- `pnpm dev:api`, `db:migrate`, `db:seed` and Prisma Studio refuse a hosted database unless `HEALTHFLOW_DB_ROLE=staging` is set. Production only ever runs `migrate deploy`, from Render.
- The guard is `scripts/db-guard.mjs`. It reads `DATABASE_URL` from the environment or the `.env` file.

To make the staging database (this needs the Neon console and cannot be done from the repository):

1. In Neon, create a branch of the production database named `staging`. A branch is a copy that cannot change production.
2. Copy its connection string into your local `.env` as `DATABASE_URL`, and add `HEALTHFLOW_DB_ROLE=staging`. Run `pnpm db:migrate` there to try a schema change before it reaches production.
3. For a hosted staging API, create a second Render web service from `render.yaml`, change its name, give it the staging `DATABASE_URL` and its own secrets, and turn auto-deploy off. Staging must not share production's `MFA_ENCRYPTION_KEY` unless it holds a copy of production data.
4. A staging branch holds a copy of real staff data. Treat it as production for access, or reset it from a branch of an empty schema.

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
- Local development is guarded against the live database, but a staging database exists only once you make it in Neon (see above).
- The Content Security Policy is strict for scripts (a nonce on every page view, added by the Worker) but still allows inline styles, because React sets style attributes and those cannot carry a nonce.
- `pnpm audit` reports one high advisory, in a package the Prisma command line uses while migrating. It is not loaded by the running API or website.

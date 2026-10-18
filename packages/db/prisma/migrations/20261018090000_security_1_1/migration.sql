-- Security, version 1.1: hosting and sub-processors named as the system uses them,
-- breach notice 48 hours, backups 24 hours, audit reason, security contact.
INSERT INTO "LegalDocument" ("id","slug","title","version","body","effectiveDate","publishedAt","publishedBy","summaryOfChanges","material")
SELECT 'legal_security_1_1','security','Security','1.1',
$body$## Read this before approving
This page describes the technical and organisational measures HealthFlow applies to staff personal data, so a district health directorate can review them before approval.

## Measures
- **Encryption in transit and at rest.** All data is transmitted over TLS and encrypted at rest.
- **Role-based access and least privilege.** Every action is scoped to the caller's facility or district.
- **Multi-factor authentication** for facility administrators, district officers and PS Tech staff, with no option to skip.
- **Append-only audit logging.** Every material change is recorded with who made it and when. Changes to a person's status, attendance corrections, accepted rule findings, restored rosters, write-offs and data-request decisions also record the reason given.
- **Automated backups.** Recovery point objective of 24 hours.

## Where the data is hosted
HealthFlow runs on Cloudflare (the website), Render (the application server) and Neon (the database).

## Sub-processors
- Cloudflare: website delivery
- Render: application server
- Neon: database
- Resend: sending email
- Paystack: online payments. It receives the administrator's email address and the invoice amount only.

No other sub-processor processes personal data.

## Data Protection Commission registration
Registration is pending. The registration number will be shown here once issued.

## Breach notification commitment
We notify affected facilities and the Data Protection Commission without undue delay, and no later than 48 hours after becoming aware of a personal data breach.

## Report a vulnerability
Email montysavagesoja@gmail.com. This address is monitored.$body$,
'2026-10-18T00:00:00Z', NOW(), 'PS Tech',
'Hosting and sub-processors listed as used. Breach notice set to 48 hours. Audit log records the reason. Backup objective stated as 24 hours. New security contact.', false
WHERE NOT EXISTS (SELECT 1 FROM "LegalDocument" WHERE "slug" = 'security' AND "version" = '1.1');

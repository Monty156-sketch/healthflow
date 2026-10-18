-- The Hospital plan covers 81 to 499 staff (it stopped at 300). Only changed if it
-- has not been edited in the console since it was seeded.
UPDATE "Plan" SET "staffBandMax" = 499 WHERE "id" = 'plan_hospital' AND "staffBandMax" = 300;

-- Security, version 1.0, as supplied by PS Tech. Published as a stored legal
-- document so the public page shows it, and a later version can replace it
-- from the console.
INSERT INTO "LegalDocument" ("id","slug","title","version","body","effectiveDate","publishedAt","publishedBy","summaryOfChanges","material")
SELECT 'legal_security_1_0','security','Security','1.0',
$body$## Read this before approving
This page describes the technical and organisational measures HealthFlow applies to staff personal data, so a district health directorate can review them before approval.

## Measures
- **Encryption in transit and at rest.** All data is transmitted over TLS and encrypted at rest.
- **Role-based access and least privilege.** Every action is scoped to the caller's facility or district.
- **Multi-factor authentication for administrators.**
- **Immutable audit logging.** Every material change is recorded with the actor, date and reason.
- **Automated backups.** Recovery point objective of 24 hours; recovery time objective of 4 hours.

## Where the data is hosted
Data is hosted on Google Cloud. Data for Ghanaian facilities is processed in the European region.

## Sub-processors
- Google Cloud: hosting
- Google Workspace: email

No other sub-processor processes personal data.

## Data Protection Commission registration
Registration is pending. The registration number will be shown here once issued.

## Breach notification commitment
We notify affected facilities and the Data Protection Commission without undue delay, and no later than 72 hours after becoming aware of a personal data breach.

## Report a vulnerability
Email security@pstech.com.gh. This address is monitored.$body$,
'2026-10-05T00:00:00Z', NOW(), 'PS Tech', 'First published version.', false
WHERE NOT EXISTS (SELECT 1 FROM "LegalDocument" WHERE "slug" = 'security' AND "version" = '1.0');

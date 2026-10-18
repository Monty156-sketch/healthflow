// Append-only. Nothing in this app ever calls auditLog.update or
// auditLog.delete — and per the spec's wave 0, the Postgres role the API
// connects as has no UPDATE/DELETE grant on this table at all (see
// infra/neon-grants.sql), so even a bug in this file cannot violate it.
import { prisma } from "./prisma.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "mfaSecretEncrypted",
  "recoveryCodesHashed",
  "tokenHash",
]);

function strip(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(strip);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : strip(v);
  }
  return out;
}

export async function writeAuditLog(entry: {
  facilityId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** A readable sentence — "A. Dery's duty on 14 August changed from Night to Off Duty by K. Bawa" — not a record type and an id. */
  summary: string;
  /** Why, as the person gave it. Kept apart from the sentence so it can be read and filtered on its own. */
  reason?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      facilityId: entry.facilityId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ? (strip(entry.before) as object) : undefined,
      after: entry.after ? (strip(entry.after) as object) : undefined,
      summary: entry.summary,
      reason: entry.reason ?? null,
    },
  });
}

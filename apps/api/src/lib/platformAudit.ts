import type { Request } from "express";
import { writeAuditLog } from "./audit.js";
import { liveUser } from "../middleware/liveUser.js";

/** One entry in the platform's own log, and, when a facility is touched, one in the facility's. */
export async function platformAudit(req: Request, action: string, summary: string, opts: { facilityId?: string | null; entityType: string; entityId?: string }) {
  const who = liveUser(req);
  await writeAuditLog({ facilityId: null, actorEmail: who.email, action: `platform_${action}`, entityType: opts.entityType, entityId: opts.entityId, summary });
  if (opts.facilityId) {
    await writeAuditLog({ facilityId: opts.facilityId, actorEmail: who.email, action: `platform_${action}`, entityType: opts.entityType, entityId: opts.entityId, summary: `PS Tech (support access): ${summary}` });
  }
}


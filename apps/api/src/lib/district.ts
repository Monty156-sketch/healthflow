// What a district officer may see. The rule, in one place: a facility appears
// only while it has an ACTIVE grant, and a screen reads only the data classes
// that grant covers. Both are worked out from the database on every request, so
// withdrawing a grant takes effect on the next click, mid-session.
import type { Request } from "express";
import type { DistrictScope } from "@healthflow/db";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

export interface Granted {
  facilityId: string;
  name: string;
  scopes: DistrictScope[];
}

/** Facilities that have an active grant to this district which includes the scope. */
export async function grantedFor(districtId: string, scope: DistrictScope): Promise<Granted[]> {
  const grants = await prisma.districtGrant.findMany({
    where: { districtId, status: "ACTIVE", scopes: { has: scope }, facility: { active: true, status: { not: "SUSPENDED" } } },
    include: { facility: { select: { name: true } } },
    orderBy: { facility: { name: "asc" } },
  });
  return grants.map((g) => ({ facilityId: g.facilityId, name: g.facility.name, scopes: g.scopes }));
}

export const SCOPE_WORD: Record<DistrictScope, string> = { COVERAGE: "coverage", STAFFING: "staffing", ATTENDANCE: "attendance", COMPLIANCE: "compliance" };

/** Facilities in this district that PS Tech has suspended. Their data is not shown to the district; only the fact, and the reason. */
export async function suspendedFor(districtId: string) {
  const rows = await prisma.facility.findMany({ where: { districtId, active: true, status: "SUSPENDED" }, select: { id: true, name: true, accessNote: true }, orderBy: { name: "asc" } });
  return rows.map((f) => ({ id: f.id, name: f.name, reason: f.accessNote }));
}

/** Every district read is written to the facility's own audit log, naming the district user and what they read. */
export async function auditDistrictRead(req: Request, granted: Granted[], screen: string, scope: DistrictScope) {
  const who = req.district!;
  await Promise.all(
    granted.map((g) =>
      writeAuditLog({
        facilityId: g.facilityId, actorEmail: who.email, action: "district_read", entityType: "DistrictGrant",
        summary: `${who.email}, district officer for ${who.districtName}, viewed ${screen} under the ${SCOPE_WORD[scope]} permission.`,
      }),
    ),
  );
}

/** The wording shown on every district screen: which grants it is reading under. */
export const readingUnder = (granted: Granted[], scope: DistrictScope) => ({
  scope,
  facilities: granted.map((g) => ({ id: g.facilityId, name: g.name })),
  sentence: granted.length
    ? `Reading the ${SCOPE_WORD[scope]} permission granted by ${granted.length} ${granted.length === 1 ? "facility" : "facilities"}.`
    : `No facility has granted the ${SCOPE_WORD[scope]} permission, so there is nothing to show.`,
});

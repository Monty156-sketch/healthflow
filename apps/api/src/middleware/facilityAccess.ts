// Access to one facility's own data (the /api/facility routes).
//
// Standing instruction: "Every backend function begins by resolving the
// caller's UserProfile, deriving the permitted facility IDs from its scope
// pair, and rejecting anything outside that list."
//
// Two deliberate choices:
// - The profile is read from the database on every request, not taken from
//   the signed access token. Deactivating someone therefore stops them on
//   their very next request, not up to 15 minutes later when the token runs
//   out, and a role change applies at once.
// - The facility is always the caller's own. No route takes a facility ID
//   from the request, so there is nothing to tamper with. Platform admins get
//   no facility data here: per the spec (Part 3, 7.5) PS Tech enters a
//   facility only through a logged, time-limited support session (Wave 7).
import type { NextFunction, Request, Response } from "express";
import type { Role } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";

export interface FacilityCaller {
  userId: string;
  email: string;
  /** How the person appears in audit sentences: their staff name when linked. */
  displayName: string;
  role: Role;
  facilityId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: FacilityCaller;
    }
  }
}

export async function requireFacilityUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthenticated" });

  const profile = await prisma.userProfile.findUnique({
    where: { id: req.auth.sub },
    select: {
      id: true,
      userEmail: true,
      role: true,
      scopeType: true,
      facilityId: true,
      active: true,
      staff: { select: { fullName: true } },
    },
  });

  if (!profile || !profile.active) {
    return res.status(401).json({ error: "session_ended" });
  }
  if (profile.scopeType !== "FACILITY" || !profile.facilityId) {
    return res.status(403).json({ error: "no_facility_access" });
  }

  req.caller = {
    userId: profile.id,
    email: profile.userEmail,
    displayName: profile.staff?.fullName ?? profile.userEmail,
    role: profile.role,
    facilityId: profile.facilityId,
  };
  next();
}

export function allowRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.caller || !roles.includes(req.caller.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

/** Who may look at the facility's people and set-up. */
export const READ_ROLES: Role[] = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"];
/** Who may change them. */
export const ADMIN_ROLES: Role[] = ["FACILITY_ADMIN"];

/** The caller, for handlers that run after requireFacilityUser. */
export function caller(req: Request): FacilityCaller {
  if (!req.caller) throw new Error("requireFacilityUser must run before this handler");
  return req.caller;
}

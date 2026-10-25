// "Every backend function begins by resolving the caller's UserProfile,
// deriving the permitted facility IDs from its scope pair, and rejecting
// anything outside that list. Filtering in the frontend is never access
// control." — Part 2 of the build documentation, applied here as one
// middleware so it cannot be forgotten on a new route.
import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/tokens.js";
import { prisma } from "../lib/prisma.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  try {
    req.auth = verifyAccessToken(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}

export function requireRole(...roles: AccessTokenPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

/**
 * Resolves which facility IDs the caller may act on, mirroring the spec's
 * `resolveScope`. A district officer gets every facility with an active
 * DistrictGrant; a facility-scoped user gets exactly their own facility.
 *
 * A platform admin gets none. Per the spec (Part 3, 7.5) PS Tech sees a
 * facility's data only through a logged, time-limited support session
 * (Wave 7), never by standing access.
 */
export async function resolveFacilityScope(
  auth: AccessTokenPayload
): Promise<string[] | "all"> {
  if (auth.scopeType === "PLATFORM") return [];

  if (auth.scopeType === "DISTRICT") {
    const agency = auth.scopeId ? (await prisma.district.findUnique({ where: { id: auth.scopeId }, select: { agency: true } }))?.agency : undefined;
    const grants = await prisma.districtGrant.findMany({
      where: { districtId: auth.scopeId ?? undefined, status: "ACTIVE", ...(agency ? { facility: { agency } } : {}) },
      select: { facilityId: true },
    });
    return grants.map((g) => g.facilityId);
  }

  // FACILITY scope
  return auth.facilityId ? [auth.facilityId] : [];
}

/** Rejects a request whose target facility is outside the caller's resolved scope. */
export function requireFacilityScope(getFacilityId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "unauthenticated" });
    const targetFacilityId = getFacilityId(req);
    if (!targetFacilityId) return res.status(400).json({ error: "facility_id_required" });

    const scope = await resolveFacilityScope(req.auth);
    if (scope !== "all" && !scope.includes(targetFacilityId)) {
      return res.status(403).json({ error: "outside_scope" });
    }
    next();
  };
}

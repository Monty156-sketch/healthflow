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
import { writeAuditLog } from "../lib/audit.js";

export interface FacilityCaller {
  userId: string;
  email: string;
  /** How the person appears in audit sentences: their staff name when linked. */
  displayName: string;
  role: Role;
  facilityId: string;
  /** The staff record linked to this account, if any. */
  staffId: string | null;
  /** A ward roster manager works on this department's rosters only. Null means the whole facility. */
  departmentId?: string | null;
  /** Set when PS Tech support is acting inside this facility through an open support session. */
  supportSessionId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: FacilityCaller;
    }
  }
}

/** Writes that stay open on a suspended facility: a person's own data rights, reading notifications, and paying an invoice. */
/** What a facility waiting for approval, declined, or unpaid can still reach: its access status, its bills and its notices. */
const LOCKED_OK = ["/api/facility/access", "/api/facility/billing", "/api/facility/notifications"];

const SUSPENDED_OK = ["/api/facility/me/", "/api/facility/notifications", "/api/facility/billing"];

/** What full-access support may not do even inside a session: hand out access, touch personal-data rights, billing, or take a copy of everything. */
const SUPPORT_NEVER = ["/api/facility/privacy", "/api/facility/invitations", "/api/facility/billing", "/api/facility/notices/legal", "/api/facility/directorate", "/api/facility/me/"];
const SUPPORT_NEVER_READ = ["/api/facility/privacy/export", "/api/facility/me/data"];

/**
 * PS Tech support acting inside a facility. The platform account sends the
 * id of its own open session; the facility is the session's, never the
 * request's. Read-only sessions can read. Full sessions can also change
 * things, each change is written to the facility's own audit log, and the
 * session ends by itself after an hour.
 */
async function supportCaller(req: Request, res: Response, email: string, userId: string, sessionId: string) {
  const s = await prisma.supportSession.findFirst({
    where: { id: sessionId, platformUserEmail: email, endedAt: null, expiresAt: { gt: new Date() } },
    include: { facility: { select: { status: true } } },
  });
  if (!s) {
    res.status(403).json({ error: "support_session_ended", message: "This support session has ended. Start another from Support access." });
    return null;
  }
  const write = !["GET", "HEAD"].includes(req.method);
  const url = req.originalUrl.split("?")[0];
  if (write && s.accessLevel !== "FULL") {
    res.status(403).json({ error: "support_read_only", message: "This support session is read only. Start a full access session to make changes." });
    return null;
  }
  if ((write && SUPPORT_NEVER.some((p) => url.startsWith(p))) || SUPPORT_NEVER_READ.some((p) => url.startsWith(p))) {
    res.status(403).json({ error: "support_not_allowed", message: "Support access cannot do this. The facility's own administrator has to." });
    return null;
  }
  if (write) {
    res.on("finish", () => {
      if (res.statusCode < 400) {
        writeAuditLog({ facilityId: s.facilityId, actorEmail: email, action: "support_change", entityType: "SupportSession", entityId: s.id, summary: `PS Tech support (${email}) made a change during a full access session: ${req.method} ${url.replace("/api/facility", "") || "/"}.` }).catch(() => undefined);
      }
    });
  }
  const caller: FacilityCaller = { userId, email, displayName: `PS Tech support (${email})`, role: "FACILITY_ADMIN", facilityId: s.facilityId, staffId: null, supportSessionId: s.id };
  return caller;
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
      staffId: true,
      departmentId: true,
      staff: { select: { fullName: true } },
      facility: { select: { status: true } },
    },
  });

  if (!profile || !profile.active) {
    return res.status(401).json({ error: "session_ended" });
  }
  const sessionHeader = req.header("x-support-session");
  if (sessionHeader && profile.role === "PLATFORM_ADMIN") {
    const c = await supportCaller(req, res, profile.userEmail, profile.id, sessionHeader);
    if (!c) return;
    req.caller = c;
    return next();
  }
  if (profile.scopeType !== "FACILITY" || !profile.facilityId) {
    return res.status(403).json({ error: "no_facility_access" });
  }

  const st = profile.facility?.status;
  if ((st === "PENDING" || st === "DECLINED" || st === "LAPSED") && !LOCKED_OK.some((p) => req.originalUrl.startsWith(p))) {
    const m = { PENDING: ["pending_approval", "This facility is waiting for PS Tech to approve it. We will email you when it is open."], DECLINED: ["declined", "This registration was not approved. Call PS Tech on 055 457 1800."], LAPSED: ["payment_required", "Access is paused until the bill is paid."] }[st];
    return res.status(402).json({ error: m[0], message: m[1] });
  }

  // A suspended facility keeps read access and keeps its export. It cannot
  // generate or edit. Staff can still use their own data rights.
  if (profile.facility?.status === "SUSPENDED" && !["GET", "HEAD"].includes(req.method) && !SUSPENDED_OK.some((p) => req.originalUrl.startsWith(p))) {
    return res.status(403).json({ error: "suspended", message: "This facility's account is suspended, so changes are paused. Everything can still be read and exported. Contact PS Tech." });
  }

  req.caller = {
    userId: profile.id,
    email: profile.userEmail,
    displayName: profile.staff?.fullName ?? profile.userEmail,
    role: profile.role,
    facilityId: profile.facilityId,
    staffId: profile.staffId,
    departmentId: profile.role === "FACILITY_ADMIN" ? null : profile.departmentId,
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

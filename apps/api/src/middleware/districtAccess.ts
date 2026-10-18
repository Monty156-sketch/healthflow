// Access for district officers. Like facility access, the account is read from
// the database on every request. The district module is read only: nothing but
// GET gets past this, so there is no screen or direct call that can write.
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export interface DistrictCaller {
  userId: string;
  email: string;
  districtId: string;
  districtName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      district?: DistrictCaller;
    }
  }
}

export async function requireDistrictOfficer(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthenticated" });
  const p = await prisma.userProfile.findUnique({ where: { id: req.auth.sub }, select: { id: true, userEmail: true, role: true, scopeType: true, scopeId: true, active: true } });
  if (!p || !p.active) return res.status(401).json({ error: "session_ended" });
  if (p.role !== "DISTRICT_OFFICER" || p.scopeType !== "DISTRICT" || !p.scopeId) return res.status(403).json({ error: "forbidden" });
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "read_only", message: "The district view is read only." });
  const d = await prisma.district.findUnique({ where: { id: p.scopeId }, select: { id: true, name: true, active: true } });
  if (!d || !d.active) return res.status(403).json({ error: "forbidden" });
  req.district = { userId: p.id, email: p.userEmail, districtId: d.id, districtName: d.name };
  next();
}

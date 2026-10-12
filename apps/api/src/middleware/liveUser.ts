// For routes about the signed-in person themselves (their account,
// sessions, password, two-step sign-in), whatever their role or scope.
// Like the facility check, it reads the account from the database on every
// request, so a disabled account is refused at once.
import type { NextFunction, Request, Response } from "express";
import type { Role } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";

export interface LiveUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  facilityId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      liveUser?: LiveUser;
    }
  }
}

export async function requireLiveUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthenticated" });
  const profile = await prisma.userProfile.findUnique({
    where: { id: req.auth.sub },
    select: {
      id: true,
      userEmail: true,
      role: true,
      facilityId: true,
      active: true,
      staff: { select: { fullName: true } },
    },
  });
  if (!profile || !profile.active) return res.status(401).json({ error: "session_ended" });
  req.liveUser = {
    id: profile.id,
    email: profile.userEmail,
    displayName: profile.staff?.fullName ?? profile.userEmail,
    role: profile.role,
    facilityId: profile.facilityId,
  };
  next();
}

export function liveUser(req: Request): LiveUser {
  if (!req.liveUser) throw new Error("requireLiveUser must run before this handler");
  return req.liveUser;
}

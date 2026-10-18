// Feature flags, read. A capability that has a flag is on for a facility when
// the flag is on globally or lists that facility. A capability whose flag has
// never been created is on, so nothing disappears until PS Tech creates the
// flag to restrict it (for example to pilot it with one directorate).
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma.js";

/** Every flag that exists, as key -> on for this facility. */
export async function flagsFor(facilityId: string): Promise<Record<string, boolean>> {
  const rows = await prisma.featureFlag.findMany();
  return Object.fromEntries(rows.map((f) => [f.key, f.enabledGlobally || f.enabledForFacilityIds.includes(facilityId)]));
}

export async function flagOn(key: string, facilityId: string): Promise<boolean> {
  const f = await prisma.featureFlag.findUnique({ where: { key } });
  return !f || f.enabledGlobally || f.enabledForFacilityIds.includes(facilityId);
}

/** Answers as if the route is not there when the flag is off for the caller's facility. */
export function requireFlag(key: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.caller && !(await flagOn(key, req.caller.facilityId))) return res.status(404).json({ error: "not_enabled", message: "This is not switched on for your facility yet." });
    next();
  };
}

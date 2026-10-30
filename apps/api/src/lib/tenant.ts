// Row-level security plumbing. Which facility a request is working for is carried in
// AsyncLocalStorage, and lib/prisma.ts turns it into database settings the policies read.
// Nothing here does anything unless RLS_ENFORCE=on (see RUNBOOK.md, "Row-level security").
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export type Tenant = { facilityId: string } | { system: true } | { none: true };

export const tenantContext = new AsyncLocalStorage<Tenant>();

export const rlsEnforced = () => process.env.RLS_ENFORCE === "on";

/** Run work as the system: schedulers, sign-in, registration, and flows that really cross facilities. */
export function asSystem<T>(fn: () => T): Promise<Awaited<T>> {
  return runIn({ system: true }, fn);
}

// Prisma queries are lazy: they start when awaited, not when created. Awaiting inside the scope makes the
// query run with this scope's settings instead of whatever scope the caller later awaits it in.
function runIn<T>(tenant: Tenant, fn: () => T): Promise<Awaited<T>> {
  return tenantContext.run(tenant, async () => await fn());
}

/** Work for one facility, outside a request: a background job narrowing itself to the facility it is handling. */
export function inFacilityRun<T>(facilityId: string, fn: () => T): Promise<Awaited<T>> {
  return runIn({ facilityId }, fn);
}

/** Express: sees no facility's rows. Set before sign-in is checked, so a route that forgets to pick a facility gets nothing instead of everything. */
export function noFacilityYet(_req: Request, _res: Response, next: NextFunction) {
  tenantContext.run({ none: true }, next);
}

/** Express: everything after this on the request is limited to one facility's rows. */
export function inFacility(facilityId: string, next: NextFunction) {
  tenantContext.run({ facilityId }, next);
}

/** Express: for routers that legitimately work across facilities (transfers, deployments, district grants). */
export function systemScope(_req: Request, _res: Response, next: NextFunction) {
  tenantContext.run({ system: true }, next);
}

/** The two settings the database policies read: the facility, and whether this is trusted system work. */
export function settingsFor(t: Tenant | undefined): { facilityId: string; bypass: "on" | "off" } {
  if (t && "facilityId" in t) return { facilityId: t.facilityId, bypass: "off" };
  if (t && "system" in t) return { facilityId: "", bypass: "on" };
  // The enforced test run drives lib code directly, outside any request; HTTP routes still get their real scope.
  if (!t && process.env.NODE_ENV === "test" && process.env.RLS_TEST_UNSCOPED === "system") return { facilityId: "", bypass: "on" };
  // No tenant set at all (including "none"): sees nothing. Work that forgets to pick a scope fails closed.
  return { facilityId: "", bypass: "off" };
}

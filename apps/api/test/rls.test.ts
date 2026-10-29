import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

// A role that does not own the tables, standing in for the restricted role the API uses in production.
async function probeRole() {
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hf_rls_probe') THEN CREATE ROLE hf_rls_probe NOLOGIN; END IF;
  END $$`);
  await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hf_rls_probe`);
}

type Settings = { facility?: string; bypass?: boolean };
async function asProbe<T>(s: Settings, fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE hf_rls_probe`);
    await tx.$executeRaw`SELECT set_config('app.facility_id', ${s.facility ?? ""}, true), set_config('app.bypass_rls', ${s.bypass ? "on" : "off"}, true)`;
    return fn(tx);
  });
}

describe("row-level security policies", () => {
  it("a restricted role sees and writes only the facility it is working for", async () => {
    await probeRole();
    const a = await makeFacility("A Clinic");
    const b = await makeFacility("B Clinic");
    await makeUser({ role: "STAFF", facilityId: a.id, withStaff: { fullName: "Ama A" } });
    await makeUser({ role: "STAFF", facilityId: a.id, withStaff: { fullName: "Esi A" } });
    await makeUser({ role: "STAFF", facilityId: b.id, withStaff: { fullName: "Kofi B" } });

    const seenByA = await asProbe({ facility: a.id }, (tx) => tx.staff.findMany({ select: { fullName: true, facilityId: true } }));
    expect(seenByA).toHaveLength(2);
    expect(seenByA.every((s) => s.facilityId === a.id)).toBe(true);

    // With nothing set, nothing is visible. Forgetting to set the facility fails closed.
    expect(await asProbe({}, (tx) => tx.staff.count())).toBe(0);
    // Trusted system work sees everything.
    expect(await asProbe({ bypass: true }, (tx) => tx.staff.count())).toBe(3);

    // A facility cannot change another facility's rows, even when it knows the id.
    const kofi = await prisma.staff.findFirstOrThrow({ where: { facilityId: b.id } });
    const changed = await asProbe({ facility: a.id }, (tx) => tx.staff.updateMany({ where: { id: kofi.id }, data: { fullName: "Hacked" } }));
    expect(changed.count).toBe(0);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: kofi.id } })).fullName).toBe("Kofi B");

    // Nor write a row that belongs to another facility.
    await expect(
      asProbe({ facility: a.id }, (tx) => tx.staff.create({ data: { facilityId: b.id, staffNo: "X1", fullName: "Planted", status: "ACTIVE" } })),
    ).rejects.toThrow();
  });
});

describe("row-level security on the remaining tables", () => {
  it("hides other facilities' audit rows and lets everyone read national holidays", async () => {
    await probeRole();
    const a = await makeFacility("A Clinic");
    const b = await makeFacility("B Clinic");
    await prisma.auditLog.create({ data: { facilityId: a.id, action: "x", entityType: "T", summary: "A did something" } });
    await prisma.auditLog.create({ data: { facilityId: b.id, action: "x", entityType: "T", summary: "B did something" } });
    await prisma.auditLog.create({ data: { facilityId: null, action: "x", entityType: "T", summary: "Platform event" } });
    const seen = await asProbe({ facility: a.id }, (tx) => tx.auditLog.findMany({ select: { summary: true } }));
    expect(seen.map((r) => r.summary).sort()).toEqual(["A did something", "Platform event"]);
    expect(await asProbe({}, (tx) => tx.auditLog.count())).toBe(0);
    // A platform event can still be written from inside a facility.
    await asProbe({ facility: a.id }, (tx) => tx.auditLog.create({ data: { facilityId: null, action: "y", entityType: "T", summary: "Another platform event" } }));
    expect(await asProbe({ bypass: true }, (tx) => tx.auditLog.count())).toBe(4);

    const day = new Date("2026-12-25");
    await prisma.publicHoliday.create({ data: { facilityId: null, date: day, name: "Christmas", year: 2026 } });
    await prisma.publicHoliday.create({ data: { facilityId: b.id, date: day, name: "B local day", year: 2026 } });
    const holidays = await asProbe({ facility: a.id }, (tx) => tx.publicHoliday.findMany({ select: { name: true } }));
    expect(holidays.map((h) => h.name)).toEqual(["Christmas"]);
  });
});

describe("row-level security in the API client", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sets the facility for plain queries and for transactions, and refuses the array form", async () => {
    vi.stubEnv("RLS_ENFORCE", "on");
    vi.resetModules();
    const { prisma: p } = await import("../src/lib/prisma.js");
    const { tenantContext, asSystem } = await import("../src/lib/tenant.js");

    const f = await makeFacility("C Clinic");
    const g = await makeFacility("D Clinic");
    await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Yaw C" } });
    await makeUser({ role: "STAFF", facilityId: g.id, withStaff: { fullName: "Efua D" } });

    const setting = (tx: { $queryRaw: typeof prisma.$queryRaw }) =>
      tx.$queryRaw<{ f: string; b: string }[]>`SELECT current_setting('app.facility_id', true) AS f, current_setting('app.bypass_rls', true) AS b`;

    // Queries still work through the wrapper (this connection owns the tables, so it is not restricted).
    expect(await tenantContext.run({ facilityId: f.id }, () => p.staff.count())).toBe(2);

    const inside = await tenantContext.run({ facilityId: f.id }, () => p.$transaction(async (tx) => setting(tx)));
    expect(inside[0]).toEqual({ f: f.id, b: "off" });

    const system = await asSystem(() => p.$transaction(async (tx) => setting(tx)));
    expect(system[0]).toEqual({ f: "", b: "on" });

    // No context at all is treated as trusted system work (sign-in, schedulers).
    const none = await p.$transaction(async (tx) => setting(tx));
    expect(none[0].b).toBe("on");

    // A facility route that has not chosen a facility yet sees nothing.
    const { noFacilityYet } = await import("../src/lib/tenant.js");
    const denied = await new Promise<{ f: string; b: string }>((resolve, reject) =>
      noFacilityYet({} as never, {} as never, () => { p.$transaction(async (tx) => setting(tx)).then((r) => resolve(r[0]), reject); }),
    );
    expect(denied).toEqual({ f: "", b: "off" });

    expect(() => p.$transaction([p.staff.count()])).toThrow(/async \(tx\)/);
    await p.$disconnect();
  });
});

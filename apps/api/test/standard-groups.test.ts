import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { seedGroups, STANDARD_CADRES, STANDARD_DEPARTMENTS } from "../src/lib/facilitySetup.js";

beforeEach(resetDatabase);

describe("standard cadres and departments", () => {
  it("are added once, by name, and never duplicate what a facility already has", async () => {
    const facility = await makeFacility("Sombo");
    await prisma.cadre.create({ data: { facilityId: facility.id, name: "midwife" } });
    const first = await seedGroups(facility.id);
    expect(first.cadres).toBe(STANDARD_CADRES.length - 1);
    expect(first.departments).toBe(STANDARD_DEPARTMENTS.length);
    const again = await seedGroups(facility.id);
    expect(again).toEqual({ cadres: 0, departments: 0 });
    expect(await prisma.cadre.count({ where: { facilityId: facility.id, name: { equals: "Midwife", mode: "insensitive" } } })).toBe(1);
  });

  it("let a staff import use common names without turning anyone away", async () => {
    const facility = await makeFacility("Sombo");
    await seedGroups(facility.id);
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const csv = ["Staff number,Full name,Cadre,Department", "S1,Esi,Staff Nurse,OPD", "S2,Yaw,Lab Technologist,Lab", "S3,Kofi,Midwife,Maternity"].join("\n");
    const prev = (await as(user).post("/api/facility/staff-import/preview", { csv })).body;
    expect(prev.totals).toEqual({ create: 3, update: 0, error: 0 });
  });
});

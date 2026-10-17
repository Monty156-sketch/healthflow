import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
  const doctor = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Doctor", code: "MD", sortOrder: 2 } });
  const mk = async (name: string, code: string, start: string, end: string, over: boolean, cadres: string[] = []) =>
    (await api.post("/api/facility/shifts", { name, code, startTime: start, endTime: end, isOvernight: over, minStaff: 1, eligibleCadreIds: cadres, colour: "#25619f" })).body.shift as { id: string };
  const morning = await mk("Morning", "A", "08:00", "14:00", false);
  const night = await mk("Night", "N", "20:00", "08:00", true);
  const clinic = await mk("Clinic", "C", "08:00", "16:00", false, [doctor.id]);
  const body = (extra: object) => ({ staffNo: "N1", fullName: "Ama Dery", employmentStatus: "PERMANENT", cadreId: nurse.id, ...extra });
  return { api, nurse, morning, night, clinic, body };
}

describe("per-staff shift eligibility", () => {
  it("saves the shifts a person may work, shows them, and lists them in the audit sentence when changed", async () => {
    const { api, morning, night, body } = await setup();
    const created = await api.post("/api/facility/staff", body({ eligibleShiftIds: [morning.id] }));
    expect(created.status).toBe(201);
    expect(created.body.staff.eligibleShifts.map((s: { name: string }) => s.name)).toEqual(["Morning"]);
    const id = created.body.staff.id;
    const upd = await api.patch(`/api/facility/staff/${id}`, body({ eligibleShiftIds: [morning.id, night.id] }));
    expect(upd.body.staff.eligibleShifts).toHaveLength(2);
    const log = await prisma.auditLog.findFirst({ where: { action: "staff_updated" }, orderBy: { createdAt: "desc" } });
    expect(log?.summary).toMatch(/shifts they may work from Morning to Morning, Night/);
    const cleared = await api.patch(`/api/facility/staff/${id}`, body({ eligibleShiftIds: [] }));
    expect(cleared.body.staff.eligibleShifts).toEqual([]);
  });

  it("refuses a shift that is not open to their cadre, or not this facility's", async () => {
    const { api, clinic, body } = await setup();
    const r = await api.post("/api/facility/staff", body({ eligibleShiftIds: [clinic.id] }));
    expect(r.status).toBe(400);
    expect(r.body.fields.eligibleShiftIds).toMatch(/not open to this person's cadre/);
    const bad = await api.post("/api/facility/staff", body({ staffNo: "N2", eligibleShiftIds: ["nope"] }));
    expect(bad.body.fields.eligibleShiftIds).toMatch(/your own list/);
  });
});

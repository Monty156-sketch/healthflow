import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

// The admin has a staff record too, so a facility set up with n nurses has n + 1 people to roster.
async function setup(staffCount = 17) {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
  for (let i = 1; i <= staffCount; i++) {
    await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `S${String(i).padStart(2, "0")}`, fullName: `Nurse ${i}`, status: "ACTIVE", cadreId: nurse.id } });
  }
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean, minStaff: number) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff, colour: "#25619f" });
  const shifts = [
    (await mk("A", "Morning", "08:00", "14:00", false, 3)).body.shift,
    (await mk("M", "Afternoon", "14:00", "20:00", false, 2)).body.shift,
    (await mk("N", "Night", "20:00", "08:00", true, 2)).body.shift,
  ];
  return { facility, admin, api, nurse, shifts };
}

describe("rosters", () => {
  it("creates a month once, generates it, and fills every cell", async () => {
    const { api, facility } = await setup();
    const created = await api.post("/api/facility/rosters", { year: 2026, month: 11 });
    expect(created.status).toBe(201);
    expect(created.body.roster).toMatchObject({ label: "November 2026", status: "DRAFT" });
    const again = await api.post("/api/facility/rosters", { year: 2026, month: 11 });
    expect(again.status).toBe(409);

    const id = created.body.roster.id;
    const gen = await api.post(`/api/facility/rosters/${id}/generate`);
    expect(gen.status).toBe(200);
    expect(gen.body.roster.status).toBe("GENERATED");
    expect(gen.body.summary.unfilled).toBe(0);
    expect(gen.body.summary.blocks).toBe(0);

    // 18 people x 30 days (17 nurses and the admin), every cell holding something, Off Duty included.
    expect(await prisma.rosterAssignment.count({ where: { rosterId: id } })).toBe(18 * 30);
    const view = (await api.get(`/api/facility/rosters/${id}`)).body;
    expect(view.staff).toHaveLength(18);
    expect(view.assignments).toHaveLength(540);
    expect(view.shifts.some((s: { code: string }) => s.code === "D/O")).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "roster_generated" } });
    expect(audit?.summary).toMatch(/^Kofi Bawa generated the roster for November 2026: \d+ duties, 0 unfilled, 0 blocking findings\. Applied \d+ duty cycles? and \d+ rotation orders?, variation 0\.$/);

    const list = (await api.get("/api/facility/rosters")).body.rosters;
    expect(list[0]).toMatchObject({ label: "November 2026", status: "GENERATED", unfilled: 0, blocks: 0 });
  });

  it("generating again with the same variation gives the same roster, and reports what it applied", async () => {
    const { api } = await setup();
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    const key = async () => (await api.get(`/api/facility/rosters/${id}`)).body.assignments.map((a: { staffId: string; date: string; shiftId: string }) => `${a.staffId}|${a.date}|${a.shiftId}`).sort().join(",");
    const first = await api.post(`/api/facility/rosters/${id}/generate`, { variation: 5 });
    expect(first.body.applied).toMatchObject({ variation: 5 });
    expect(Array.isArray(first.body.applied.cycles)).toBe(true);
    const one = await key();
    const again = await api.post(`/api/facility/rosters/${id}/generate`, { variation: 5 });
    expect(again.status).toBe(200);
    expect(await key()).toBe(one);
  });

  it("generating again without a variation picks a new one", async () => {
    const { api } = await setup();
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    await api.post(`/api/facility/rosters/${id}/generate`);
    const again = await api.post(`/api/facility/rosters/${id}/generate`);
    expect(again.status).toBe(200);
    expect(again.body.applied.variation).toBeGreaterThan(0);
  });

  it("carries the run across the month boundary", async () => {
    const { api, facility, shifts } = await setup();
    const morning = shifts[0];
    const oct = (await api.post("/api/facility/rosters", { year: 2026, month: 10 })).body.roster.id;
    const first = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S01" } });
    // S01 ended October with four morning duties in a row.
    for (const d of [28, 29, 30, 31]) {
      await prisma.rosterAssignment.create({ data: { rosterId: oct, facilityId: facility.id, staffId: first.id, shiftId: morning.id, dutyDate: new Date(Date.UTC(2026, 9, d)) } });
    }
    const nov = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    expect((await api.post(`/api/facility/rosters/${nov}/generate`)).status).toBe(200);
    const off = await prisma.shift.findFirstOrThrow({ where: { facilityId: facility.id, countsAsDuty: false } });
    const mine = await prisma.rosterAssignment.findMany({ where: { rosterId: nov, staffId: first.id }, orderBy: { dutyDate: "asc" } });
    let run = 4;
    let longest = 4;
    for (const a of mine) {
      run = a.shiftId === off.id ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    // Counting the four days from October, no more than six duty days in a row.
    expect(longest).toBeLessThanOrEqual(6);
  });

  it("stops and names the shortfall when there are not enough people", async () => {
    const { api } = await setup(2);
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    const gen = await api.post(`/api/facility/rosters/${id}/generate`);
    expect(gen.status).toBe(409);
    expect(gen.body.error).toBe("not_feasible");
    expect(gen.body.shortfalls[0].sentence).toBe("On 1 November the shifts need 7 people between them, and only 3 people are available.");
    expect(await prisma.rosterAssignment.count({ where: { rosterId: id } })).toBe(0);
  });

  it("says so when no shift asks for anyone, and when there is no staff", async () => {
    const facility = await makeFacility("Empty Clinic");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
    const api = as(user);
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    expect((await api.post(`/api/facility/rosters/${id}/generate`)).body.error).toBe("no_staff");
    await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "S1", fullName: "One", status: "ACTIVE" } });
    expect((await api.post(`/api/facility/rosters/${id}/generate`)).body.error).toBe("no_demand");
  });

  it("validating finds a breach that was put in by hand", async () => {
    const { api, facility, shifts } = await setup();
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    await api.post(`/api/facility/rosters/${id}/generate`);
    const person = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S01" } });
    await prisma.rosterAssignment.deleteMany({ where: { rosterId: id, staffId: person.id, dutyDate: { in: [new Date(Date.UTC(2026, 10, 10)), new Date(Date.UTC(2026, 10, 11))] } } });
    const [, , night] = shifts;
    const morning = shifts[0];
    await prisma.rosterAssignment.create({ data: { rosterId: id, facilityId: facility.id, staffId: person.id, shiftId: night.id, dutyDate: new Date(Date.UTC(2026, 10, 10)), source: "MANUAL" } });
    await prisma.rosterAssignment.create({ data: { rosterId: id, facilityId: facility.id, staffId: person.id, shiftId: morning.id, dutyDate: new Date(Date.UTC(2026, 10, 11)), source: "MANUAL" } });
    const res = await api.post(`/api/facility/rosters/${id}/validate`);
    expect(res.status).toBe(200);
    const findings = (await api.get(`/api/facility/rosters/${id}`)).body.findings;
    const c6 = findings.find((f: { ruleCode: string; staffId: string }) => f.ruleCode === "C6" && f.staffId === person.id);
    expect(c6.message).toBe("Nurse 1 — A on 11 November starts at 08:00, but N on 10 November runs until 08:00. Both cannot be worked.");
    expect(c6.severity).toBe("BLOCK");
  });

  it("is limited to roster roles, and one facility cannot see another's roster", async () => {
    const { api, facility } = await setup();
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    const { user: supervisor } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(supervisor).get("/api/facility/rosters")).status).toBe(200);
    expect((await as(supervisor).post(`/api/facility/rosters/${id}/generate`)).status).toBe(403);
    expect((await as(supervisor).post("/api/facility/rosters", { year: 2026, month: 12 })).status).toBe(403);
    const { user: staffUser } = await makeUser({ role: "STAFF", facilityId: facility.id });
    expect((await as(staffUser).get("/api/facility/rosters")).status).toBe(403);

    const other = await makeFacility("Another Clinic");
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(otherAdmin).get(`/api/facility/rosters/${id}`)).status).toBe(404);
    expect((await as(otherAdmin).post(`/api/facility/rosters/${id}/generate`)).status).toBe(404);
    expect((await as(otherAdmin).post(`/api/facility/rosters/${id}/validate`)).status).toBe(404);
    expect((await as(otherAdmin).get("/api/facility/rosters")).body.rosters).toHaveLength(0);
  });
});

describe("who is on the roster", () => {
  it("keeps in-charges to weekday mornings, doctors off, and nights to cadres and departments that take them", async () => {
    const { facility, api, nurse, shifts } = await setup(12);
    const doctors = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Medical Officer", sortOrder: 2, onRoster: false, takesNights: false } });
    const noNights = await prisma.department.create({ data: { facilityId: facility.id, name: "Eye", runsNights: false } });
    const doctor = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "D01", fullName: "Dr Mensah", status: "ACTIVE", cadreId: doctors.id } });
    const inCharge = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "IC1", fullName: "Sister Amina", position: "Nurse In-charge", status: "ACTIVE", cadreId: nurse.id, morningOnly: true } });
    const eye = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "E01", fullName: "Eye Nurse", status: "ACTIVE", cadreId: nurse.id, departmentId: noNights.id } });
    const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id;
    const gen = await api.post(`/api/facility/rosters/${id}/generate`, {});
    expect(gen.status).toBe(200);
    const rows = await prisma.rosterAssignment.findMany({ where: { rosterId: id }, include: { shift: true } });
    const duties = (staffId: string) => rows.filter((r) => r.staffId === staffId && r.shift.countsAsDuty);
    expect(duties(doctor.id)).toHaveLength(0);
    expect(rows.filter((r) => r.staffId === doctor.id)).toHaveLength(0);
    expect(duties(inCharge.id).length).toBeGreaterThan(15);
    expect(duties(inCharge.id).every((r) => r.shift.code === "A" && ![0, 6].includes(r.dutyDate.getUTCDay()))).toBe(true);
    expect(duties(eye.id).some((r) => r.shift.isOvernight)).toBe(false);
    expect(shifts.length).toBe(3);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
  for (let i = 1; i <= 17; i++) {
    await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `S${String(i).padStart(2, "0")}`, fullName: `Nurse ${i}`, status: "ACTIVE", cadreId: nurse.id } });
  }
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean, minStaff: number) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff, colour: "#25619f" });
  await mk("A", "Morning", "08:00", "14:00", false, 3);
  await mk("M", "Afternoon", "14:00", "20:00", false, 2);
  await mk("N", "Night", "20:00", "08:00", true, 2);
  const id = (await api.post("/api/facility/rosters", { year: 2026, month: 11 })).body.roster.id as string;
  await api.post(`/api/facility/rosters/${id}/generate`);
  const view = (await api.get(`/api/facility/rosters/${id}`)).body;
  const shift = (code: string) => view.shifts.find((s: { code: string }) => s.code === code).id as string;
  return { facility, admin, api, id, view, shift, person: view.staff[1].id as string };
}

describe("editing a duty", () => {
  it("refuses until the roster is generated, then saves a manual, locked duty and writes the audit log", async () => {
    const { api, facility, person, shift } = await setup();
    const draft = (await api.post("/api/facility/rosters", { year: 2026, month: 12 })).body.roster.id;
    const early = await api.put(`/api/facility/rosters/${draft}/cell`, { staffId: person, date: "2026-12-03", shiftId: shift("D/O") });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("Generate the roster before changing duties.");

    const { id } = (await prisma.roster.findFirstOrThrow({ where: { facilityId: facility.id, month: 11 } }));
    const res = await api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date: "2026-11-05", shiftId: shift("D/O"), overrideReason: "Requested a day off" });
    expect(res.status).toBe(200);
    const row = await prisma.rosterAssignment.findFirstOrThrow({ where: { rosterId: id, staffId: person, dutyDate: new Date(Date.UTC(2026, 10, 5)) } });
    expect(row).toMatchObject({ source: "MANUAL", locked: true });
    expect(await prisma.rosterAssignment.count({ where: { rosterId: id, staffId: person, dutyDate: new Date(Date.UTC(2026, 10, 5)) } })).toBe(1);
    const log = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "roster_cell_changed" } });
    expect(log?.summary).toMatch(/^Kofi Bawa changed Nurse 2 on 5 November in the November 2026 roster from .+ to Off Duty/);
  });

  it("stops a change that breaks a blocking rule unless the manager gives a reason", async () => {
    const { api, id, person, shift } = await setup();
    const put = (date: string, code: string, overrideReason?: string) =>
      api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date, shiftId: shift(code), overrideReason });
    await put("2026-11-10", "N", "Cover for sickness on nights");
    await put("2026-11-11", "D/O", "Rest after the night");
    const refused = await put("2026-11-11", "A");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("blocks_rule");
    expect(refused.body.findings.some((f: { ruleCode: string }) => f.ruleCode === "C6")).toBe(true);
    const short = await put("2026-11-11", "A", "no");
    expect(short.status).toBe(400);
    const done = await put("2026-11-11", "A", "Only person who could cover the morning");
    expect(done.status).toBe(200);
    const findings = (await api.get(`/api/facility/rosters/${id}`)).body.findings;
    const c6 = findings.find((f: { ruleCode: string; staffId: string }) => f.ruleCode === "C6" && f.staffId === person);
    expect(c6.status).toBe("OVERRIDDEN");
    // checking again keeps the accepted finding accepted
    await api.post(`/api/facility/rosters/${id}/validate`);
    const again = (await api.get(`/api/facility/rosters/${id}`)).body.findings.find((f: { ruleCode: string; staffId: string }) => f.ruleCode === "C6" && f.staffId === person);
    expect(again.status).toBe("OVERRIDDEN");
  });
});

describe("review, approval and publishing", () => {
  it("moves a roster through each status, with a version saved on approval and publishing, and locks editing", async () => {
    const { api, id, facility, person, shift } = await setup();
    const act = (action: string) => api.post(`/api/facility/rosters/${id}/status`, { action });
    expect((await act("approve")).status).toBe(409); // not yet in review
    expect((await act("submit")).body.roster.status).toBe("UNDER_REVIEW");
    // still editable while in review
    expect((await api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date: "2026-11-20", shiftId: shift("D/O"), overrideReason: "Annual leave day" })).status).toBe(200);
    const approved = await act("approve");
    expect(approved.body.roster).toMatchObject({ status: "APPROVED", version: 2 });
    const locked = await api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date: "2026-11-21", shiftId: shift("D/O"), overrideReason: "Annual leave day" });
    expect(locked.status).toBe(409);
    expect((await act("publish")).body.roster).toMatchObject({ status: "PUBLISHED", version: 3 });
    expect((await prisma.roster.findUniqueOrThrow({ where: { id } })).publishedAt).not.toBeNull();
    expect(await prisma.rosterVersionSnapshot.count({ where: { rosterId: id } })).toBe(2);
    expect((await act("archive")).body.roster.status).toBe("ARCHIVED");
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "roster_publish" } })).toBe(1);
  });

  it("will not approve with an open blocking finding until it is fixed or accepted with a reason", async () => {
    const { api, id, facility, person, shift } = await setup();
    const day = (n: number) => new Date(Date.UTC(2026, 10, n));
    await prisma.rosterAssignment.deleteMany({ where: { rosterId: id, staffId: person, dutyDate: { in: [day(10), day(11)] } } });
    await prisma.rosterAssignment.createMany({
      data: [
        { rosterId: id, facilityId: facility.id, staffId: person, shiftId: shift("N"), dutyDate: day(10), source: "MANUAL" },
        { rosterId: id, facilityId: facility.id, staffId: person, shiftId: shift("A"), dutyDate: day(11), source: "MANUAL" },
      ],
    });
    await api.post(`/api/facility/rosters/${id}/validate`);
    await api.post(`/api/facility/rosters/${id}/status`, { action: "submit" });
    const blocked = await api.post(`/api/facility/rosters/${id}/status`, { action: "approve" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("open_blocks");

    const findings = (await api.get(`/api/facility/rosters/${id}`)).body.findings;
    const open = findings.filter((f: { severity: string; status: string }) => f.severity === "BLOCK" && f.status === "OPEN");
    for (const f of open) {
      expect((await api.post(`/api/facility/rosters/${id}/findings/${f.id}/override`, { reason: "x" })).status).toBe(400);
      expect((await api.post(`/api/facility/rosters/${id}/findings/${f.id}/override`, { reason: "Agreed with the matron for this month" })).status).toBe(200);
    }
    expect((await api.post(`/api/facility/rosters/${id}/status`, { action: "approve" })).status).toBe(200);
  });

  it("lets only a facility admin approve, and keeps other facilities out", async () => {
    const { api, id, facility } = await setup();
    await api.post(`/api/facility/rosters/${id}/status`, { action: "submit" });
    const { user: manager } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id });
    expect((await as(manager).post(`/api/facility/rosters/${id}/status`, { action: "approve" })).status).toBe(403);
    const other = await makeFacility("Another Clinic");
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(otherAdmin).post(`/api/facility/rosters/${id}/status`, { action: "approve" })).status).toBe(404);
  });
});

describe("versions", () => {
  it("keeps the roster as it was before generating again, and restores any saved version", async () => {
    const { api, id, person, shift } = await setup();
    const day = new Date(Date.UTC(2026, 10, 5));
    const cellOf = () => prisma.rosterAssignment.findFirstOrThrow({ where: { rosterId: id, staffId: person, dutyDate: day } });
    await api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date: "2026-11-05", shiftId: shift("D/O"), overrideReason: "Requested a day off" });
    const edited = (await cellOf()).shiftId;
    expect(edited).toBe(shift("D/O"));

    await api.post(`/api/facility/rosters/${id}/generate`); // locked manual duty survives
    const list = (await api.get(`/api/facility/rosters/${id}/versions`)).body;
    expect(list.versions).toHaveLength(1);
    expect(list.versions[0].reason).toBe("Before generating again");
    expect(list.current).toBe(2);

    // change it again, then restore the saved version
    await api.put(`/api/facility/rosters/${id}/cell`, { staffId: person, date: "2026-11-05", shiftId: shift("M"), overrideReason: "Covering a colleague" });
    const restore = await api.post(`/api/facility/rosters/${id}/versions/${list.versions[0].id}/restore`, { reason: "Wrong shift pattern" });
    expect(restore.status).toBe(200);
    expect((await cellOf()).shiftId).toBe(edited);
    const after = (await api.get(`/api/facility/rosters/${id}/versions`)).body;
    expect(after.versions[0].reason).toBe(`Before restoring version ${list.versions[0].version}`);
    expect(after.current).toBe(3);
  });

  it("will not restore into an approved roster, or from another facility", async () => {
    const { api, id } = await setup();
    await api.post(`/api/facility/rosters/${id}/generate`);
    const vid = (await api.get(`/api/facility/rosters/${id}/versions`)).body.versions[0].id;
    await api.post(`/api/facility/rosters/${id}/status`, { action: "submit" });
    await api.post(`/api/facility/rosters/${id}/status`, { action: "approve" });
    const locked = await api.post(`/api/facility/rosters/${id}/versions/${vid}/restore`);
    expect(locked.status).toBe(409);
    const other = await makeFacility("Another Clinic");
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(otherAdmin).get(`/api/facility/rosters/${id}/versions`)).status).toBe(404);
    expect((await as(otherAdmin).post(`/api/facility/rosters/${id}/versions/${vid}/restore`)).status).toBe(404);
  });

  it("downloads the roster as a PDF at any status, and the audit log notes it", async () => {
    const { api, id } = await setup();
    const res = await api.get(`/api/facility/rosters/${id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/roster-2026-11\.pdf/);
    const log = await prisma.auditLog.findFirst({ where: { action: "roster_pdf_downloaded" } });
    expect(log?.summary).toMatch(/November 2026 roster as a PDF/);
  });
});

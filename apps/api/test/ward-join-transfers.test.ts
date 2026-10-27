import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, as, freshIp, makeFacility, makeUser, prisma, resetDatabase, PASSWORD } from "./helpers.js";
import { applyTransfer, applyDueTransfers } from "../src/routes/facility/transfers.js";
import { loadEngineData } from "../src/routes/facility/rosters.js";

beforeEach(resetDatabase);

const pub = (u: string, b: object) => request(app).post(u).set("X-Forwarded-For", freshIp()).send(b);

async function hospital() {
  const facility = await makeFacility("Upper West Regional Hospital");
  await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: "REGIONAL_HOSPITAL" } });
  await prisma.privacyNotice.create({ data: { facilityId: facility.id, version: "1", body: "Notice", publishedAt: new Date() } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
  const api = as(admin);
  const code = (await api.get("/api/facility/join/code")).body.code as string;
  await api.put("/api/facility/join/code", { requiresApproval: false, active: true });
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", sortOrder: 1 } });
  const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
  const surgery = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
  return { facility, api, code, nurse, maternity, surgery };
}

const reg = (code: string, email: string, extra: object) => ({ code, fullName: email.split("@")[0], email, password: PASSWORD, acceptedNoticeVersion: "1", ...extra });
const profileOf = (email: string) => prisma.userProfile.findUniqueOrThrow({ where: { userEmail: email } });

describe("hospital registration with in-charges", () => {
  it("asks for a ward, holds an in-charge for the administrator, and lets the in-charge approve their own ward", async () => {
    const { api, code, nurse, maternity, surgery } = await hospital();
    expect((await request(app).get(`/api/public/join/${code}`).set("X-Forwarded-For", freshIp())).body.byWard).toBe(true);
    expect((await pub("/api/public/join/register", reg(code, "nobody@h.test", { cadreId: nurse.id }))).body.fields.departmentId).toBeTruthy();

    // The administrator lists the in-charge with a rank and ward. Signing up with that name fills both in.
    expect((await api.post("/api/facility/in-charges", { fullName: "Sister", rank: "Principal Nursing Officer", departmentId: surgery.id })).status).toBe(201);
    const listedRow = (await api.get("/api/facility/in-charges")).body.inCharges[0] as { id: string };
    expect((await api.post("/api/facility/in-charges", { fullName: "  SISTER ", rank: "Nursing Officer" })).status).toBe(400);
    expect((await api.patch(`/api/facility/in-charges/${listedRow.id}`, { fullName: "Sister", rank: "Principal Nursing Officer", departmentId: maternity.id })).status).toBe(200);
    const probe = (name: string) => request(app).get(`/api/public/join/${code}/in-charge`).query({ name }).set("X-Forwarded-For", freshIp());
    expect((await probe("sister")).body).toMatchObject({ listed: true, rank: "Principal Nursing Officer", ward: "Maternity" });
    expect((await probe("Somebody Else")).body).toEqual({ listed: false });

    // Approval is off for staff, but an in-charge always waits. The ward they send is ignored; the list decides.
    const ic = await pub("/api/public/join/register", reg(code, "sister@h.test", { cadreId: nurse.id, departmentId: surgery.id }));
    expect(ic.body.status).toBe("pending");
    const sister = await prisma.staff.findFirstOrThrow({ where: { email: "sister@h.test" } });
    expect(sister).toMatchObject({ requestedInCharge: true, departmentId: maternity.id, position: "Principal Nursing Officer" });
    expect((await probe("sister")).body).toEqual({ listed: false });
    const second = await pub("/api/public/join/register", reg(code, "sister@elsewhere.test", { fullName: "Sister", cadreId: nurse.id, departmentId: maternity.id }));
    expect((await prisma.staff.findFirstOrThrow({ where: { email: "sister@elsewhere.test" } })).requestedInCharge).toBe(false);
    expect(second.status).toBe(201);
    expect((await api.post("/api/facility/join/approve", { staffIds: [sister.id] })).body.approved).toBe(1);
    const p = await profileOf("sister@h.test");
    expect(p).toMatchObject({ role: "ROSTER_MANAGER", departmentId: maternity.id, active: true });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: sister.id } })).morningOnly).toBe(true);

    // With approval on, the ward's in-charge sees and approves their own ward's staff only.
    await api.put("/api/facility/join/code", { requiresApproval: true, active: true });
    await pub("/api/public/join/register", reg(code, "ama@h.test", { cadreId: nurse.id, departmentId: maternity.id }));
    await pub("/api/public/join/register", reg(code, "kofi@h.test", { cadreId: nurse.id, departmentId: surgery.id }));
    // Claiming to be an in-charge without being on the list does nothing.
    await pub("/api/public/join/register", reg(code, "rival@h.test", { cadreId: nurse.id, departmentId: maternity.id, asInCharge: true }));
    expect((await prisma.staff.findFirstOrThrow({ where: { email: "rival@h.test" } })).requestedInCharge).toBe(false);
    // The ward's own in-charge is told about ward staff, not the administrator; a ward with no in-charge goes to the administrator.
    const told = async (title: string) => (await prisma.notification.findMany({ where: { type: "join_pending", title: { contains: title } } })).map((n) => n.recipientEmail).sort();
    expect(await told("ama")).toEqual(["sister@h.test"]);
    expect((await told("kofi")).length).toBe(1);
    expect((await told("kofi"))[0]).not.toBe("sister@h.test");
    const ward = as(p);
    const waiting = ((await ward.get("/api/facility/join/pending")).body.pending as { id: string; fullName: string }[]).sort((a, b) => a.fullName.localeCompare(b.fullName));
    expect(waiting.map((w) => w.fullName)).toEqual(["ama", "rival"]);
    const kofi = await prisma.staff.findFirstOrThrow({ where: { email: "kofi@h.test" } });
    expect((await ward.post("/api/facility/join/approve", { staffIds: [kofi.id] })).status).toBe(404);
    expect((await ward.post("/api/facility/join/approve", { staffIds: [waiting[0].id], departmentId: surgery.id })).status).toBe(403);
    expect((await ward.post("/api/facility/join/approve", { staffIds: [waiting[0].id] })).body.approved).toBe(1);
    expect((await ward.get("/api/facility/join/code")).status).toBe(403);

    // The in-charge's staff list is their ward.
    const names = ((await ward.get("/api/facility/staff")).body.staff as { fullName: string }[]).map((s) => s.fullName).sort();
    expect(names).toEqual(["Sister", "ama", "rival", "sister"]);
    expect((await ward.get(`/api/facility/staff/${kofi.id}`)).status).toBe(404);
  });
});

describe("inter-ward transfers", () => {
  it("moves a person, keeps their earlier duties, drops later ones, and counts them on the new ward from their day", async () => {
    const { facility, api, nurse, maternity, surgery } = await hospital();
    const ama = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "M1", fullName: "Ama", status: "ACTIVE", cadreId: nurse.id, departmentId: maternity.id } });
    const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
    const mat = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: maternity.id })).body.roster.id;
    const sur = (await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: surgery.id })).body.roster.id;
    for (const d of ["2026-11-10", "2026-11-20"]) {
      await prisma.rosterAssignment.create({ data: { rosterId: mat, facilityId: facility.id, staffId: ama.id, shiftId: shift.id, dutyDate: new Date(`${d}T00:00:00Z`), source: "MANUAL" } });
    }

    expect((await api.post("/api/facility/transfers", { staffId: ama.id, toDepartmentId: maternity.id, effectiveDate: "2099-01-01" })).body.fields.toDepartmentId).toBeTruthy();
    expect((await api.post("/api/facility/transfers", { staffId: ama.id, toDepartmentId: surgery.id, effectiveDate: "2020-01-01" })).body.fields.effectiveDate).toBeTruthy();
    const made = await api.post("/api/facility/transfers", { staffId: ama.id, toDepartmentId: surgery.id, effectiveDate: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), kind: "ROUTINE" });
    expect(made.status).toBe(201);
    expect(made.body.transfer.status).toBe("SCHEDULED");
    expect((await api.post("/api/facility/transfers", { staffId: ama.id, toDepartmentId: surgery.id, effectiveDate: made.body.transfer.effectiveDate })).status).toBe(409);

    // Pin the day inside the November rosters to check them.
    await prisma.wardTransfer.update({ where: { id: made.body.transfer.id }, data: { effectiveDate: new Date("2026-11-15T00:00:00Z") } });
    const surData = await loadEngineData(facility.id, sur, 2026, 11);
    expect(surData.staff.map((s) => s.id)).toContain(ama.id);
    const before = surData.leave.find((l) => l.staffId === ama.id)!;
    expect(before.endDay - before.startDay).toBe(13);
    const matData = await loadEngineData(facility.id, mat, 2026, 11);
    expect(matData.leave.some((l) => l.staffId === ama.id)).toBe(true);

    expect(await applyTransfer(made.body.transfer.id, "test")).toBe(true);
    expect(await applyTransfer(made.body.transfer.id, "test")).toBe(false);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: ama.id } })).departmentId).toBe(surgery.id);
    const left = await prisma.rosterAssignment.findMany({ where: { rosterId: mat, staffId: ama.id } });
    expect(left.map((a) => [a.dutyDate.toISOString().slice(0, 10), a.locked])).toEqual([["2026-11-10", true]]);
    expect((await api.get("/api/facility/transfers")).body.transfers[0].status).toBe("DONE");
    expect((await api.post(`/api/facility/transfers/${made.body.transfer.id}/cancel`, {})).status).toBe(409);
    expect(await applyDueTransfers()).toBe(0);
  });

  it("makes the person in charge of the new ward when asked; an in-charge moves only their own ward's people", async () => {
    const { facility, api, maternity, surgery } = await hospital();
    const { user: manager, staff } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" } });
    await prisma.staff.update({ where: { id: staff!.id }, data: { departmentId: maternity.id, status: "ACTIVE" } });
    await prisma.userProfile.update({ where: { id: manager.id }, data: { departmentId: maternity.id } });
    const today = new Date().toISOString().slice(0, 10);
    const other = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "S9", fullName: "Kofi", status: "ACTIVE", departmentId: surgery.id } });
    expect((await as(manager).post("/api/facility/transfers", { staffId: other.id, toDepartmentId: maternity.id, effectiveDate: today })).status).toBe(400);
    expect((await as(manager).post("/api/facility/transfers", { staffId: staff!.id, toDepartmentId: surgery.id, effectiveDate: today, inCharge: true })).status).toBe(403);
    const now = await api.post("/api/facility/transfers", { staffId: staff!.id, toDepartmentId: surgery.id, effectiveDate: new Date().toISOString().slice(0, 10), kind: "EMERGENCY", inCharge: true });
    expect(now.body.transfer.status).toBe("DONE");
    expect(await profileOf(manager.userEmail)).toMatchObject({ role: "ROSTER_MANAGER", departmentId: surgery.id });
    expect((await as(manager).get("/api/facility/transfers")).body.transfers).toHaveLength(1);
  });
});

describe("support units and the staff record", () => {
  it("adds security, drivers and cleaners, and no administration unit; staff register into them; offices get no roster; support units start from nobody", async () => {
    const { facility, api, code, nurse } = await hospital();
    const units = (await request(app).get(`/api/public/join/${code}`).set("X-Forwarded-For", freshIp())).body.departments as { id: string; name: string; kind: string }[];
    const security = units.find((u) => u.name === "Security")!;
    const accounts = await prisma.department.create({ data: { facilityId: facility.id, name: "Accounts office", kind: "OFFICE", runsNights: false } });
    expect(units.some((u) => u.name === "Administration")).toBe(false);
    expect(security.kind).toBe("SUPPORT");
    // Asking to be in-charge of a support unit just registers them; the administrator runs it.
    const guard = await pub("/api/public/join/register", reg(code, "guard@h.test", { departmentId: security.id, asInCharge: true }));
    expect(guard.body.status).toBe("active");
    expect((await prisma.staff.findFirstOrThrow({ where: { email: "guard@h.test" } })).requestedInCharge).toBe(false);
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: accounts.id })).status).toBe(400);
    const sec = await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: security.id });
    expect(sec.status).toBe(201);
    await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 3, colour: "#25619f" });
    const demand = (await api.get(`/api/facility/ward-demand/${security.id}`)).body.shifts;
    expect(demand[0].minStaff).toBe(0);
    const gen = await api.post(`/api/facility/rosters/${sec.body.roster.id}/generate`, {});
    expect(gen.body.error).toBe("no_demand");
    // Shown once only: switching a unit off does not bring it back.
    expect((await api.get("/api/facility/departments")).body.departments.filter((d: { name: string }) => d.name === "Security")).toHaveLength(1);
  });

  it("records a ward change on the staff record as a transfer and cancels their open swaps in the old ward", async () => {
    const { facility, api, nurse, maternity, surgery } = await hospital();
    const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
    const [ama, efua] = await Promise.all(["Ama", "Efua"].map((n, i) => prisma.staff.create({ data: { facilityId: facility.id, staffNo: `M${i}`, fullName: n, status: "ACTIVE", cadreId: nurse.id, departmentId: maternity.id } })));
    const now = new Date();
    const mat = (await api.post("/api/facility/rosters", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, departmentId: maternity.id })).body.roster.id;
    const later = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (later.getUTCMonth() !== now.getUTCMonth()) return; // last day of the month: nothing later to cancel
    const [a, b] = await Promise.all([ama, efua].map((p) => prisma.rosterAssignment.create({ data: { rosterId: mat, facilityId: facility.id, staffId: p.id, shiftId: shift.id, dutyDate: later, source: "MANUAL" } })));
    const swap = await prisma.dutySwap.create({ data: { facilityId: facility.id, rosterId: mat, swapType: "EXCHANGE", requesterStaffId: efua.id, requesterAssignmentId: b.id, targetStaffId: ama.id, targetAssignmentId: a.id } });

    const record = (await api.get(`/api/facility/staff/${ama.id}`)).body.staff;
    const res = await api.patch(`/api/facility/staff/${ama.id}`, { staffNo: record.staffNo, fullName: record.fullName, cadreId: nurse.id, departmentId: surgery.id, employmentStatus: record.employmentStatus, excludedFromNights: false, willingForExtraDuties: false, maxDutiesPerWeek: 0, eligibleShiftIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.staff.department.name).toBe("Surgery");
    const t = await prisma.wardTransfer.findFirstOrThrow({ where: { staffId: ama.id } });
    expect(t.appliedAt).not.toBeNull();
    expect((await prisma.dutySwap.findUniqueOrThrow({ where: { id: swap.id } })).status).toBe("CANCELLED");
    expect(await prisma.rosterAssignment.count({ where: { id: a.id } })).toBe(0);
  });
});

describe("Ghana defaults on a new facility's cadres and staff", () => {
  it("adds a cadre the way Ghana Health Service facilities work it, and marks senior grades as leads", async () => {
    const { api } = await hospital();
    const pharm = (await api.post("/api/facility/cadres", { name: "Radiographer" })).body.cadre;
    expect(pharm).toMatchObject({ weekdaysOnly: true, takesNights: false, onRoster: true });
    const nurse = (await api.post("/api/facility/cadres", { name: "Staff Nurse" })).body.cadre;
    expect(nurse).toMatchObject({ weekdaysOnly: false, takesNights: true });
    const base = { employmentStatus: "PERMANENT", excludedFromNights: false, willingForExtraDuties: false, maxDutiesPerWeek: 0, eligibleShiftIds: [] };
    const senior = await api.post("/api/facility/staff", { ...base, staffNo: "N1", fullName: "Ama", cadreId: nurse.id, position: "Senior Staff Nurse" });
    const junior = await api.post("/api/facility/staff", { ...base, staffNo: "N2", fullName: "Efua", cadreId: nurse.id, position: "Staff Nurse" });
    expect(senior.body.staff.canLead).toBe(true);
    expect(junior.body.staff.canLead).toBe(false);
  });
});

describe("a health centre rosters by unit", () => {
  async function centre() {
    const facility = await makeFacility("Sombo Health Centre");
    await prisma.privacyNotice.create({ data: { facilityId: facility.id, version: "1", body: "Notice", publishedAt: new Date() } });
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    const api = as(admin);
    const code = (await api.get("/api/facility/join/code")).body.code as string;
    await api.put("/api/facility/join/code", { requiresApproval: false, active: true });
    const mk = (name: string, code: string, s: string, e: string, h: number, over = false) =>
      prisma.shift.create({ data: { facilityId: facility.id, name, code, startTime: s, endTime: e, durationHours: h, isOvernight: over, minStaff: 3 } });
    const [m, a, n] = [await mk("Morning", "M", "07:00", "14:00", 7), await mk("Afternoon", "A", "14:00", "20:00", 6), await mk("Night", "N", "20:00", "07:00", 11, true)];
    const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Enrolled Nurse" } });
    const midwife = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife" } });
    const units = await Promise.all(["OPD", "Maternity"].map((name) => prisma.department.create({ data: { facilityId: facility.id, name } })));
    return { facility, api, code, nurse, midwife, units, shifts: { m, a, n } };
  }

  it("puts a registering nurse and midwife in their unit, whatever department they pick", async () => {
    const { code, nurse, midwife, facility } = await centre();
    await pub("/api/public/join/register", reg(code, "esi@c.test", { cadreId: nurse.id }));
    await pub("/api/public/join/register", reg(code, "abu@c.test", { cadreId: midwife.id }));
    const where = async (email: string) => (await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, email }, include: { department: true } })).department?.name;
    expect(await where("esi@c.test")).toBe("OPD");
    expect(await where("abu@c.test")).toBe("Maternity");
  });

  it("asks which unit a roster is for and starts it from 2/1/1 for clinical nurses and 1/1/1 for midwives", async () => {
    const { api, units, shifts } = await centre();
    expect((await api.get("/api/facility")).body.facility.rosterByWard).toBe(true);
    expect((await api.post("/api/facility/rosters", { year: 2026, month: 11 })).status).toBe(400);
    for (const u of units) expect((await api.post("/api/facility/rosters", { year: 2026, month: 11, departmentId: u.id })).status).toBe(201);
    const minOf = async (dept: string, shiftId: string) => (await prisma.shiftDemand.findFirstOrThrow({ where: { departmentId: dept, shiftId } })).minStaff;
    expect([await minOf(units[0].id, shifts.m.id), await minOf(units[0].id, shifts.a.id), await minOf(units[0].id, shifts.n.id)]).toEqual([2, 1, 1]);
    expect([await minOf(units[1].id, shifts.m.id), await minOf(units[1].id, shifts.a.id), await minOf(units[1].id, shifts.n.id)]).toEqual([1, 1, 1]);
  });

  it("keeps the standard settings fixed and lets the facility add its own", async () => {
    const { api, facility } = await centre();
    const eye = await prisma.department.create({ data: { facilityId: facility.id, name: "Eye", runsNights: false } });
    const rad = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Radiographer", weekdaysOnly: true, takesNights: false } });
    expect((await api.patch(`/api/facility/departments/${eye.id}`, { name: "Eye", runsNights: true })).status).toBe(409);
    expect((await api.patch(`/api/facility/cadres/${rad.id}`, { name: "Radiographer", takesNights: true })).status).toBe(409);
    const own = (await api.post("/api/facility/departments", { name: "Chaplaincy", runsNights: false })).body.department;
    expect((await api.patch(`/api/facility/departments/${own.id}`, { name: "Chaplaincy", runsNights: true })).status).toBe(200);
  });

  it("keeps one roster, with no unit choice, for a clinic or CHPS compound", async () => {
    const { api, facility } = await centre();
    for (const type of ["CLINIC", "CHPS_COMPOUND"] as const) {
      await prisma.facility.update({ where: { id: facility.id }, data: { facilityType: type } });
      expect((await api.get("/api/facility")).body.facility.rosterByWard).toBe(false);
      const made = await api.post("/api/facility/rosters", { year: 2026, month: type === "CLINIC" ? 11 : 12 });
      expect(made.status).toBe(201);
    }
  });
});

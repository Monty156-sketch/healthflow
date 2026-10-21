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

    // Approval is off for staff, but an in-charge always waits.
    const ic = await pub("/api/public/join/register", reg(code, "sister@h.test", { cadreId: nurse.id, departmentId: maternity.id, asInCharge: true }));
    expect(ic.body.status).toBe("pending");
    const sister = await prisma.staff.findFirstOrThrow({ where: { email: "sister@h.test" } });
    expect(sister.requestedInCharge).toBe(true);
    expect((await api.post("/api/facility/join/approve", { staffIds: [sister.id] })).body.approved).toBe(1);
    const p = await profileOf("sister@h.test");
    expect(p).toMatchObject({ role: "ROSTER_MANAGER", departmentId: maternity.id, active: true });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: sister.id } })).morningOnly).toBe(true);

    // With approval on, the ward's in-charge sees and approves their own ward's staff only.
    await api.put("/api/facility/join/code", { requiresApproval: true, active: true });
    await pub("/api/public/join/register", reg(code, "ama@h.test", { cadreId: nurse.id, departmentId: maternity.id }));
    await pub("/api/public/join/register", reg(code, "kofi@h.test", { cadreId: nurse.id, departmentId: surgery.id }));
    await pub("/api/public/join/register", reg(code, "rival@h.test", { cadreId: nurse.id, departmentId: maternity.id, asInCharge: true }));
    const ward = as(p);
    const waiting = (await ward.get("/api/facility/join/pending")).body.pending as { id: string; fullName: string }[];
    expect(waiting.map((w) => w.fullName)).toEqual(["ama"]);
    const kofi = await prisma.staff.findFirstOrThrow({ where: { email: "kofi@h.test" } });
    expect((await ward.post("/api/facility/join/approve", { staffIds: [kofi.id] })).status).toBe(404);
    expect((await ward.post("/api/facility/join/approve", { staffIds: [waiting[0].id], departmentId: surgery.id })).status).toBe(403);
    expect((await ward.post("/api/facility/join/approve", { staffIds: [waiting[0].id] })).body.approved).toBe(1);
    expect((await ward.get("/api/facility/join/code")).status).toBe(403);

    // The admin can let a would-be in-charge in as ordinary staff.
    const rival = await prisma.staff.findFirstOrThrow({ where: { email: "rival@h.test" } });
    await api.post("/api/facility/join/approve", { staffIds: [rival.id], asInCharge: false });
    expect((await profileOf("rival@h.test")).role).toBe("STAFF");

    // The in-charge's staff list is their ward.
    const names = ((await ward.get("/api/facility/staff")).body.staff as { fullName: string }[]).map((s) => s.fullName).sort();
    expect(names).toEqual(["ama", "rival", "sister"]);
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

  it("makes the person in charge of the new ward when asked, and only the administrator sets transfers", async () => {
    const { facility, api, maternity, surgery } = await hospital();
    const { user: manager, staff } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" } });
    await prisma.staff.update({ where: { id: staff!.id }, data: { departmentId: maternity.id, status: "ACTIVE" } });
    await prisma.userProfile.update({ where: { id: manager.id }, data: { departmentId: maternity.id } });
    expect((await as(manager).post("/api/facility/transfers", { staffId: staff!.id, toDepartmentId: surgery.id, effectiveDate: new Date().toISOString().slice(0, 10) })).status).toBe(403);
    const now = await api.post("/api/facility/transfers", { staffId: staff!.id, toDepartmentId: surgery.id, effectiveDate: new Date().toISOString().slice(0, 10), kind: "EMERGENCY", inCharge: true });
    expect(now.body.transfer.status).toBe("DONE");
    expect(await profileOf(manager.userEmail)).toMatchObject({ role: "ROSTER_MANAGER", departmentId: surgery.id });
    expect((await as(manager).get("/api/facility/transfers")).body.transfers).toHaveLength(1);
  });
});

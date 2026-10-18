import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function world() {
  const facility = await makeFacility("Data Clinic");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
  const { user: a, staff: sa } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi Mensah" } });
  const { user: b, staff: sb } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Yaa Boateng" } });
  await prisma.staff.update({ where: { id: sa!.id }, data: { phone: "0244000111", email: "kofi@example.test", emergencyContactName: "Esi", emergencyContactPhone: "0244000222" } });
  const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Day", code: "D", startTime: "07:00", endTime: "15:00", durationHours: 8 } });
  const now = new Date();
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "PUBLISHED" } });
  const day = (n: number) => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 + n * 86_400_000);
  await prisma.rosterAssignment.createMany({ data: [1, 2].map((n) => ({ rosterId: roster.id, facilityId: facility.id, staffId: sa!.id, shiftId: shift.id, dutyDate: day(n) })).concat([{ rosterId: roster.id, facilityId: facility.id, staffId: sb!.id, shiftId: shift.id, dutyDate: day(1) }]) });
  return { facility, admin, a, b, sa: sa!, sb: sb! };
}

describe("a member of staff and their own data", () => {
  it("downloads everything held about them without asking anyone, and none of it is a colleague's", async () => {
    const { a } = await world();
    const json = await as(a).get("/api/facility/me/data/export.json");
    expect(json.status).toBe(200);
    expect(json.body.details.fullName).toBe("Kofi Mensah");
    expect(json.body.details.phone).toBe("0244000111");
    expect(json.body.duties.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(json.body)).not.toContain("Yaa Boateng");
    const csv = await as(a).get("/api/facility/me/data/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("DUTIES");
  });

  it("sees the next duty on Today, with no other staff named", async () => {
    const { a } = await world();
    const t = (await as(a).get("/api/facility/me/today")).body;
    expect(t.linked).toBe(true);
    expect(t.next.shift).toBe("Day");
    expect(t.week.length).toBeGreaterThan(0);
    expect(JSON.stringify(t)).not.toContain("Yaa");
  });

  it("can load the facility and its own screens, but not the manager's", async () => {
    const { a } = await world();
    expect((await as(a).get("/api/facility")).body.me.role).toBe("STAFF");
    expect((await as(a).get("/api/facility/staff")).status).toBe(403);
    expect((await as(a).get("/api/facility/privacy/requests")).status).toBe(403);
  });

  it("withdraws a consent, and the photograph goes with it", async () => {
    const { a, sa, facility } = await world();
    const c = await prisma.consentRecord.create({ data: { facilityId: facility.id, staffId: sa.id, consentType: "PHOTOGRAPH", granted: true, grantedAt: new Date() } });
    await prisma.staff.update({ where: { id: sa.id }, data: { photoUrl: "x", photoConsentId: c.id } });
    expect((await as(a).post(`/api/facility/me/consents/${c.id}/withdraw`, {})).status).toBe(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: sa.id } })).photoUrl).toBeNull();
  });
});

describe("data subject requests", () => {
  it("starts a 14 day clock for a correction, and flags it when overdue", async () => {
    const { a, admin } = await world();
    const r = await as(a).post("/api/facility/me/requests", { requestType: "CORRECTION", description: "My cadre is wrong on my record." });
    expect(r.status).toBe(201);
    const inbox = (await as(admin).get("/api/facility/privacy/requests")).body.requests;
    expect(inbox[0]).toMatchObject({ type: "CORRECTION", overdue: false });
    expect(inbox[0].daysLeft).toBeGreaterThanOrEqual(13);
    await prisma.dataSubjectRequest.update({ where: { id: inbox[0].id }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await as(admin).get("/api/facility/privacy/requests")).body.requests[0].overdue).toBe(true);
  });

  it("erases what it can, keeps the records and says why", async () => {
    const { a, admin, sa } = await world();
    await as(a).post("/api/facility/me/requests", { requestType: "ERASURE", description: "Please delete everything about me." });
    const id = (await as(admin).get("/api/facility/privacy/requests")).body.requests[0].id;
    const plan = (await as(admin).get(`/api/facility/privacy/requests/${id}/erasure-plan`)).body.plan;
    expect(plan.erase.map((e: { what: string }) => e.what)).toContain("Telephone number");
    expect(plan.retain.some((r: { what: string; why: string }) => /duties/.test(r.what) && r.why.length > 10)).toBe(true);
    const done = await as(admin).post(`/api/facility/privacy/requests/${id}/erase`, {});
    expect(done.status).toBe(200);
    expect(done.body.outcomeNote).toMatch(/Removed:.*Kept:/);
    const s = await prisma.staff.findUniqueOrThrow({ where: { id: sa.id } });
    expect(s.phone).toBeNull();
    expect(s.emergencyContactName).toBeNull();
    expect(await prisma.rosterAssignment.count({ where: { staffId: sa.id } })).toBe(2);
  });

  it("allows a refusal only with a reason", async () => {
    const { a, admin } = await world();
    await as(a).post("/api/facility/me/requests", { requestType: "OBJECTION", description: "I object to being rostered at night." });
    const id = (await as(admin).get("/api/facility/privacy/requests")).body.requests[0].id;
    expect((await as(admin).post(`/api/facility/privacy/requests/${id}/refuse`, { reason: "" })).status).toBe(400);
    expect((await as(admin).post(`/api/facility/privacy/requests/${id}/refuse`, { reason: "Night duty is set by the roster rules, not by personal data." })).status).toBe(200);
  });
});

describe("retention and export", () => {
  it("lists expired records and deletes nothing until a person confirms", async () => {
    const { admin, facility, sa } = await world();
    await prisma.retentionPolicy.create({ data: { facilityId: facility.id, entityType: "Notification", retentionMonths: 12, active: true, approvedBy: "x" } });
    await prisma.notification.create({ data: { facilityId: facility.id, recipientEmail: "a@b.c", recipientStaffId: sa.id, type: "t", title: "old", body: "old", createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    const { runRetentionJob } = await import("../src/lib/retention.js");
    const scan = await runRetentionJob();
    expect(scan.notified).toBe(1);
    expect(await prisma.notification.count({ where: { title: "old" } })).toBe(1);
    const due = (await as(admin).get("/api/facility/privacy/retention-due")).body.expired;
    expect(due.find((d: { entityType: string }) => d.entityType === "Notification").count).toBe(1);
    expect((await as(admin).post("/api/facility/privacy/retention-due/confirm", { entityType: "Notification" })).body.deleted).toBe(1);
    expect(await prisma.notification.count({ where: { title: "old" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "retention_deleted" } })).toBe(1);
  });

  it("exports the facility's data to an administrator, and to no one else", async () => {
    const { admin, a } = await world();
    const out = await as(admin).get("/api/facility/privacy/export.json");
    expect(out.status).toBe(200);
    expect(out.body.entities.staff.length).toBe(3);
    expect(JSON.stringify(out.body)).not.toContain("passwordHash");
    expect((await as(admin).get("/api/facility/privacy/export/staff.csv")).status).toBe(200);
    expect((await as(a).get("/api/facility/privacy/export.json")).status).toBe(403);
  });

  it("refuses the scheduler endpoint without the secret", async () => {
    const request = (await import("supertest")).default;
    const { app } = await import("./helpers.js");
    expect((await request(app).post("/api/internal/retention-scan")).status).toBe(404);
  });
});

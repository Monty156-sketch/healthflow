import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function world() {
  const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
  const facility = await makeFacility("Support Clinic");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
  const { user: staff, staff: sRow } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi Mensah" } });
  await prisma.staff.update({ where: { id: sRow!.id }, data: { phone: "0244999888", emergencyContactName: "Secret Contact" } });
  return { api: as(platform), platform, facility, admin, staff };
}

describe("support sessions", () => {
  it("will not start without a written reason, and defaults to read only", async () => {
    const { api, facility } = await world();
    expect((await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "help" })).status).toBe(400);
    const ok = await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Roster will not generate for October" });
    expect(ok.status).toBe(201);
    expect(ok.body.session.accessLevel).toBe("READ_ONLY");
    const mins = (new Date(ok.body.session.expiresAt).getTime() - new Date(ok.body.session.startedAt).getTime()) / 60_000;
    expect(Math.round(mins)).toBe(60);
  });

  it("shows a banner to the facility's own users, and logs it to the facility", async () => {
    const { api, facility, staff } = await world();
    await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Roster will not generate for October" });
    const n = (await as(staff).get("/api/facility/notices")).body;
    expect(n.support.reason).toBe("Roster will not generate for October");
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "platform_support_started" } })).toBe(1);
  });

  it("lets support see names and cadres, never phones or emergency contacts, and logs every read", async () => {
    const { api, facility } = await world();
    const id = (await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Checking the staff list for a clash" })).body.session.id;
    const out = await api.get(`/api/platform/support-sessions/${id}/view/staff`);
    expect(out.status).toBe(200);
    expect(JSON.stringify(out.body)).toContain("Kofi Mensah");
    expect(JSON.stringify(out.body)).not.toContain("0244999888");
    expect(JSON.stringify(out.body)).not.toContain("Secret Contact");
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "support_read" } })).toBe(1);
  });

  it("expires by itself, and a closed session reads nothing", async () => {
    const { api, facility, staff } = await world();
    const id = (await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Checking the staff list for a clash" })).body.session.id;
    await prisma.supportSession.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(staff).get("/api/facility/notices")).body.support).toBeNull();
    expect((await prisma.supportSession.findUniqueOrThrow({ where: { id } })).endedReason).toBe("EXPIRED");
    expect((await api.get(`/api/platform/support-sessions/${id}/view/staff`)).status).toBe(403);
  });

  it("is listed in the facility's own history with the reason", async () => {
    const { api, facility, admin } = await world();
    await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Checking the staff list for a clash" });
    const h = (await as(admin).get("/api/facility/notices/support-history")).body.sessions;
    expect(h[0].reason).toMatch(/clash/);
  });
});

describe("users", () => {
  it("resets, unlocks and deactivates, and writes each to the facility's own log", async () => {
    const { api, facility, staff } = await world();
    expect((await api.post(`/api/platform/users/${staff.id}/reset-link`, {})).body.url).toContain("reset-password");
    await prisma.userProfile.update({ where: { id: staff.id }, data: { failedAttempts: 4, lockedUntil: new Date(Date.now() + 600_000) } });
    await api.post(`/api/platform/users/${staff.id}/unlock`, {});
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { id: staff.id } })).lockedUntil).toBeNull();
    await api.post(`/api/platform/users/${staff.id}/deactivate`, {});
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { id: staff.id } })).active).toBe(false);
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "platform_user_deactivated" } })).toBe(1);
  });

  it("changes a role and records it in the facility's log, and never touches platform accounts", async () => {
    const { api, platform, facility, staff } = await world();
    expect((await api.patch(`/api/platform/users/${staff.id}/role`, { role: "SUPERVISOR" })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "platform_user_role_changed" } })).toBe(1);
    expect((await api.post(`/api/platform/users/${platform.id}/deactivate`, {})).status).toBe(403);
  });
});

describe("legal documents", () => {
  const doc = { slug: "terms", title: "Terms", version: "2", body: "x".repeat(80), effectiveDate: "2026-11-01", summaryOfChanges: "Payment terms changed", material: true };

  it("publishes a version, never edits it, and serves it publicly", async () => {
    const { api } = await world();
    expect((await api.post("/api/platform/legal", doc)).status).toBe(201);
    expect((await api.post("/api/platform/legal", doc)).status).toBe(409);
    const request = (await import("supertest")).default;
    const { app } = await import("./helpers.js");
    const pub = await request(app).get("/api/public/legal/terms");
    expect(pub.body.current.version).toBe("2");
    expect((await request(app).get("/api/public/legal/privacy")).status).toBe(404);
  });

  it("asks facility administrators to acknowledge a material change, and records who and when", async () => {
    const { api, admin, staff, facility } = await world();
    await api.post("/api/platform/legal", doc);
    expect((await as(admin).get("/api/facility/notices")).body.legalPending).toHaveLength(1);
    expect((await as(staff).get("/api/facility/notices")).body.legalPending).toHaveLength(0);
    expect((await as(admin).post("/api/facility/notices/legal/acknowledge", { slug: "terms", version: "2" })).status).toBe(200);
    expect((await as(admin).get("/api/facility/notices")).body.legalPending).toHaveLength(0);
    const reg = (await api.get("/api/platform/legal/acknowledgements")).body.documents[0].facilities.find((f: { facilityId: string }) => f.facilityId === facility.id);
    expect(reg).toMatchObject({ acknowledged: true, by: "Ama Admin" });
  });
});

describe("announcements, flags and error replies", () => {
  it("shows an announcement to the right facilities and hides it once dismissed", async () => {
    const { api, admin, facility } = await world();
    const other = await makeFacility("Other");
    await api.post("/api/platform/announcements", { title: "Maintenance", body: "Saturday 6am", severity: "MAINTENANCE", audience: "SELECTED", facilityIds: [facility.id] });
    const a = (await as(admin).get("/api/facility/notices")).body.announcements;
    expect(a).toHaveLength(1);
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(otherAdmin).get("/api/facility/notices")).body.announcements).toHaveLength(0);
    await as(admin).post(`/api/facility/notices/announcements/${a[0].id}/seen`, {});
    expect((await as(admin).get("/api/facility/notices")).body.announcements).toHaveLength(0);
  });

  it("sets a feature flag for one facility", async () => {
    const { api, facility } = await world();
    const out = await api.put("/api/platform/flags/district.oversight", { enabledGlobally: false, enabledForFacilityIds: [facility.id] });
    expect(out.body.flag.enabledForFacilityIds).toEqual([facility.id]);
    expect((await api.put("/api/platform/flags/Bad Key", { enabledGlobally: true })).status).toBe(400);
  });

  it("replies to the person who reported a problem, in the app", async () => {
    const { api, facility, staff } = await world();
    const r = await prisma.errorReport.create({ data: { facilityId: facility.id, reportedBy: staff.userEmail, description: "The roster page is blank" } });
    expect((await api.post(`/api/platform/errors/${r.id}/reply`, { message: "Fixed in today's release.", resolve: true })).body.notified).toBe(true);
    const e = await prisma.errorReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(e.status).toBe("RESOLVED");
    expect(await prisma.notification.count({ where: { recipientEmail: staff.userEmail, type: "problem_reply" } })).toBe(1);
  });
});

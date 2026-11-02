import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { csvCell } from "../src/lib/csvSafe.js";
import { limitKey } from "../src/lib/clientIp.js";
import { app, as, freshIp, makeFacility, makeUser, prisma, resetDatabase, tokenFor } from "./helpers.js";

beforeEach(resetDatabase);

describe("csvCell", () => {
  it("defuses spreadsheet formulas, keeps plain numbers and quotes commas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 and @cmd")).toBe("'+1 and @cmd");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("-5 days")).toBe("'-5 days");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell(null)).toBe("");
  });
});

describe("limitKey", () => {
  it("groups an IPv6 /64 together and leaves IPv4 alone", () => {
    expect(limitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(limitKey("2001:DB8:1:2::1"));
    expect(limitKey("2001:db8:1:3::1")).not.toBe(limitKey("2001:db8:1:2::1"));
    expect(limitKey("::ffff:10.1.2.3")).toBe("10.1.2.3");
    expect(limitKey("10.1.2.3")).toBe("10.1.2.3");
  });
});

describe("support session limits", () => {
  it("blocks invite and reset-link whatever the letter case or slashes", async () => {
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    const facility = await makeFacility("Support Clinic");
    const { staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi Mensah" } });
    const s = (await as(platform).post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Roster will not generate for October", accessLevel: "FULL" })).body.session;
    const send = (url: string) =>
      request(app).post(url).set("Authorization", `Bearer ${tokenFor(platform)}`).set("X-Forwarded-For", freshIp()).set("x-support-session", s.id).send({});
    for (const u of [`/api/facility/staff/${staff!.id}/invite`, `/api/facility/staff/${staff!.id}/reset-link`, `/api/facility/Staff/${staff!.id}/Reset-Link`, `/api/facility//staff/${staff!.id}/invite`]) {
      expect((await send(u)).body.error).toBe("support_not_allowed");
    }
  });
});

describe("a ward in-charge stays in their ward", () => {
  it("cannot adjust or read the duty ledger across wards", async () => {
    const facility = await makeFacility("Ward Hospital");
    const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
    const surgery = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
    const mk = (tag: string, departmentId: string) => prisma.staff.create({ data: { facilityId: facility.id, staffNo: tag, fullName: `Nurse ${tag}`, status: "ACTIVE", departmentId } });
    const [m1, m2, s1] = [await mk("M1", maternity.id), await mk("M2", maternity.id), await mk("S1", surgery.id)];
    const { user: incharge } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" }, mfa: true });
    await prisma.userProfile.update({ where: { id: incharge.id }, data: { departmentId: maternity.id } });
    const api = as(incharge);
    const note = "Covered a night for her last week";
    expect((await api.post("/api/facility/ledger/adjust", { debtorId: m1.id, creditorId: s1.id, duties: 1, note })).status).toBe(404);
    expect((await api.post("/api/facility/ledger/adjust", { debtorId: m1.id, creditorId: m2.id, duties: 1, note })).status).toBe(201);
    const list = (await api.get("/api/facility/ledger")).body;
    expect(list.staff.map((p: { name: string }) => p.name).sort()).toEqual(["Nurse M1", "Nurse M2"]);
    expect(JSON.stringify(list)).not.toContain("Nurse S1");
  });
});

describe("duty ledger totals for an in-charge", () => {
  it("count only their own ward", async () => {
    const facility = await makeFacility("Ward Hospital");
    const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
    const surgery = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
    const mk = (tag: string, departmentId: string) => prisma.staff.create({ data: { facilityId: facility.id, staffNo: tag, fullName: `Nurse ${tag}`, status: "ACTIVE", departmentId } });
    const [m1, m2, s1, s2] = [await mk("M1", maternity.id), await mk("M2", maternity.id), await mk("S1", surgery.id), await mk("S2", surgery.id)];
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Admin" }, mfa: true });
    const { user: incharge } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" }, mfa: true });
    await prisma.userProfile.update({ where: { id: incharge.id }, data: { departmentId: maternity.id } });
    const note = "Covered a night for her last week";
    await as(admin).post("/api/facility/ledger/adjust", { debtorId: m1.id, creditorId: m2.id, duties: 1, note });
    await as(admin).post("/api/facility/ledger/adjust", { debtorId: s1.id, creditorId: s2.id, duties: 3, note });
    expect((await as(admin).get("/api/facility/ledger")).body.summary.openDebts).toBe(4);
    expect((await as(incharge).get("/api/facility/ledger")).body.summary.openDebts).toBe(1);
  });
});

describe("one account per email", () => {
  const reg = (email: string, name = "Wa West") => ({
    name, region: "Upper West", contactName: "Ama Dery", contactRole: "District Health Director",
    contactEmail: email, contactPhone: "0240000000", officeAddress: "District Health Directorate, Wa", password: "river stone morning light",
  });
  const post = (body: object) => request(app).post("/api/public/districts/register").set("X-Forwarded-For", freshIp()).send(body);

  it("tells a second registration, in any letter case, that the email already has an account", async () => {
    expect((await post(reg("Dho@Example.com"))).status).toBe(201);
    const again = await post(reg("DHO@example.COM", "Another District"));
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already has an account/i);
    expect(await prisma.userProfile.count()).toBe(1);
  });

  it("answers two registrations sent at the same moment with one account and a plain 409", async () => {
    const [a, b] = await Promise.all([post(reg("same@example.com", "District A")), post(reg("same@example.com", "District B"))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.userProfile.count({ where: { userEmail: "same@example.com" } })).toBe(1);
  });
});

describe("deployments for a ward in-charge", () => {
  it("shows and confirms back only their own ward's people", async () => {
    const facility = await makeFacility("Ward Hospital");
    const maternity = await prisma.department.create({ data: { facilityId: facility.id, name: "Maternity" } });
    const surgery = await prisma.department.create({ data: { facilityId: facility.id, name: "Surgery" } });
    const mk = (tag: string, departmentId: string) => prisma.staff.create({ data: { facilityId: facility.id, staffNo: tag, fullName: `Nurse ${tag}`, status: "ACTIVE", departmentId } });
    const [m1, s1] = [await mk("M1", maternity.id), await mk("S1", surgery.id)];
    const { user: incharge } = await makeUser({ role: "ROSTER_MANAGER", facilityId: facility.id, withStaff: { fullName: "Sister Ama" }, mfa: true });
    await prisma.userProfile.update({ where: { id: incharge.id }, data: { departmentId: maternity.id } });
    const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
    const dep = await prisma.deployment.create({
      data: { facilityId: facility.id, name: "National exercise", startDate: day(0), endDate: day(3), createdBy: "admin@example.test", members: { create: [{ staffId: m1.id }, { staffId: s1.id }] } },
      include: { members: true },
    });
    const api = as(incharge);
    const list = (await api.get("/api/facility/deployments")).body.deployments;
    expect(list).toHaveLength(1);
    expect(list[0].members.map((m: { name: string }) => m.name)).toEqual(["Nurse M1"]);
    const other = dep.members.find((m) => m.staffId === s1.id)!;
    const refused = await api.post(`/api/facility/deployments/${dep.id}/back`, { memberIds: [other.id], date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
    expect(refused.status).toBe(409);
    expect((await prisma.deploymentMember.findUniqueOrThrow({ where: { id: other.id } })).returnedOn).toBeNull();
  });
});

describe("system health shows whether messages are getting through", () => {
  it("counts email, text and WhatsApp outcomes from the last day", async () => {
    const facility = await makeFacility("Wa Clinic");
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    await prisma.emailEvent.createMany({ data: [{ outcome: "SENT" }, { outcome: "SENT" }, { outcome: "FAILED", error: "The provider refused the message" }] });
    await prisma.emailEvent.create({ data: { outcome: "SENT", createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    await prisma.smsMessage.create({ data: { facilityId: facility.id, toPhone: "0240000000", type: "test", body: "x", status: "FAILED", error: "No credit" } });
    const h = (await as(platform).get("/api/platform/health")).body;
    expect(h.notifications.email).toMatchObject({ sent: 2, failed: 1, lastError: "The provider refused the message", configured: true });
    expect(h.notifications.sms).toMatchObject({ sent: 0, failed: 1, lastError: "No credit" });
    expect(h.notifications.whatsapp).toMatchObject({ sent: 0, failed: 0 });
    // Old outcomes are tidied away.
    expect(await prisma.emailEvent.count()).toBe(3);
    await prisma.emailEvent.create({ data: { outcome: "NOT_CONFIGURED" } });
    expect((await as(platform).get("/api/platform/health")).body.notifications.email.configured).toBe(false);
  });
});

describe("announcements are cleared by the person who clears them", () => {
  it("hides an announcement for one person only, important ones included", async () => {
    const facility = await makeFacility();
    const { user: a } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama A" } });
    const { user: b } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Esi B" } });
    const note = await prisma.announcement.create({ data: { title: "Maintenance", body: "Saturday night.", severity: "IMPORTANT", dismissible: false, startsAt: new Date(Date.now() - 1000) } });
    expect((await as(a).get("/api/facility/notices")).body.announcements.map((x: { id: string }) => x.id)).toEqual([note.id]);
    expect((await as(a).post(`/api/facility/notices/announcements/${note.id}/seen`, {})).status).toBe(200);
    expect((await as(a).get("/api/facility/notices")).body.announcements).toEqual([]);
    // Someone else in the same facility still sees it.
    expect((await as(b).get("/api/facility/notices")).body.announcements.map((x: { id: string }) => x.id)).toEqual([note.id]);
    // Clearing twice is harmless.
    expect((await as(a).post(`/api/facility/notices/announcements/${note.id}/seen`, {})).status).toBe(200);
  });
});

describe("the clock tells the person when their duty ends", () => {
  it("returns the end of the duty they clocked into while they are in, and nothing once they are out", async () => {
    const facility = await prisma.facility.create({ data: { name: "Clock Clinic", facilityType: "HEALTH_CENTRE", geoLat: 10, geoLng: -2, geoRadiusM: 200 } });
    const { user, staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Kofi C" } });
    const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Day", code: "D", startTime: "00:00", endTime: "23:59", durationHours: 24, minStaff: 1, countsAsDuty: true } });
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1, status: "PUBLISHED" } });
    const today = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    await prisma.rosterAssignment.create({ data: { facilityId: facility.id, rosterId: roster.id, staffId: staff!.id, shiftId: shift.id, dutyDate: today } });
    const api = as(user);
    expect((await api.get("/api/facility/me/clock")).body).toMatchObject({ linked: true, enabled: true, state: "OUT", dutyEndsAt: null });
    const inRes = await api.post("/api/facility/me/clock", { kind: "IN", lat: 10, lng: -2, accuracy: 5 });
    expect(inRes.status).toBe(201);
    expect(inRes.body.state).toBe("IN");
    expect(new Date(inRes.body.dutyEndsAt).getTime()).toBe(today.getTime() + (23 * 60 + 59) * 60_000);
    expect((await api.get("/api/facility/me/clock")).body.dutyEndsAt).toBe(inRes.body.dutyEndsAt);
    const outRes = await api.post("/api/facility/me/clock", { kind: "OUT", lat: 10, lng: -2, accuracy: 5 });
    expect(outRes.body).toMatchObject({ state: "OUT", dutyEndsAt: null });
  });
});

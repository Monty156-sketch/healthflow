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

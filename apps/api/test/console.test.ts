import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function platform() {
  const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
  return as(user);
}
const ask = (name = "Sombo Health Centre") => prisma.accessRequest.create({ data: { facilityName: name, contactName: "Ama Dery", contactEmail: "ama@example.com", district: "Nadowli-Kaleo", facilityType: "HEALTH_CENTRE" } });

describe("the console is not there for anyone else", () => {
  it("answers not-found, as for a route that does not exist, to a facility administrator", async () => {
    const facility = await makeFacility();
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
    for (const path of ["/api/platform/dashboard", "/api/platform/requests", "/api/platform/facilities"]) {
      expect((await as(admin).get(path)).status).toBe(404);
    }
  });
});

describe("access requests", () => {
  it("shows the oldest unanswered request first, and counts the first response only once", async () => {
    const api = await platform();
    const old = await ask("Old Clinic");
    await prisma.accessRequest.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 72 * 3_600_000) } });
    await ask("New Clinic");
    const dash = (await api.get("/api/platform/dashboard")).body;
    expect(dash.requests).toMatchObject({ waiting: 2, late: true });
    expect(dash.requests.oldestHours).toBeGreaterThanOrEqual(72);
    const list = (await api.get("/api/platform/requests")).body;
    expect(list.requests.map((r: { facilityName: string }) => r.facilityName)).toEqual(["Old Clinic", "New Clinic"]);

    const first = await api.patch(`/api/platform/requests/${old.id}`, { status: "CONTACTED" });
    expect(first.status).toBe(200);
    const stamped = (await prisma.accessRequest.findUniqueOrThrow({ where: { id: old.id } })).firstResponseAt;
    expect(stamped).not.toBeNull();
    await api.patch(`/api/platform/requests/${old.id}`, { status: "DEMO_SCHEDULED" });
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: old.id } })).firstResponseAt).toEqual(stamped);
    expect((await api.get("/api/platform/dashboard")).body.requests.waiting).toBe(1);
  });

  it("needs a reason to decline, and keeps a notes thread", async () => {
    const api = await platform();
    const r = await ask();
    expect((await api.patch(`/api/platform/requests/${r.id}`, { status: "DECLINED" })).status).toBe(400);
    expect((await api.patch(`/api/platform/requests/${r.id}`, { status: "DECLINED", reason: "Outside the pilot area" })).status).toBe(200);
    await api.post(`/api/platform/requests/${r.id}/notes`, { body: "Rang the in-charge, call back in March" });
    const detail = (await api.get(`/api/platform/requests/${r.id}`)).body;
    expect(detail.request.declineReason).toBe("Outside the pilot area");
    expect(detail.notes).toHaveLength(1);
  });

  it("becomes a facility in one action, and the link survives", async () => {
    const api = await platform();
    const district = await prisma.district.create({ data: { name: "Nadowli-Kaleo", region: "Upper West" } });
    const r = await ask();
    expect((await api.patch(`/api/platform/requests/${r.id}`, { status: "PROVISIONED" })).status).toBe(400);
    const out = await api.post(`/api/platform/requests/${r.id}/provision`, {});
    expect(out.status).toBe(201);
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: out.body.facilityId } });
    expect(facility).toMatchObject({ name: "Sombo Health Centre", status: "TRIAL", districtId: district.id, region: "Upper West" });
    const detail = (await api.get(`/api/platform/requests/${r.id}`)).body;
    expect(detail.request.status).toBe("PROVISIONED");
    expect(detail.facility).toMatchObject({ id: facility.id });
    expect((await api.post(`/api/platform/requests/${r.id}/provision`, {})).status).toBe(409);
    // Both logs say it happened.
    expect(await prisma.auditLog.count({ where: { action: "platform_facility_provisioned", facilityId: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "platform_facility_provisioned", facilityId: facility.id } })).toBe(1);
  });
});

describe("facilities and their health", () => {
  it("marks a facility at risk when no roster was published last month, and healthy when one is", async () => {
    const api = await platform();
    const quiet = await makeFacility("Quiet Clinic");
    const busy = await makeFacility("Busy Clinic");
    await prisma.facility.updateMany({ data: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    await prisma.roster.create({ data: { facilityId: busy.id, year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, status: "PUBLISHED", publishedAt: last } });
    await prisma.roster.create({ data: { facilityId: busy.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "PUBLISHED", publishedAt: now } });
    await makeUser({ role: "FACILITY_ADMIN", facilityId: busy.id });
    await prisma.userProfile.updateMany({ where: { facilityId: busy.id }, data: { lastSignInAt: now } });
    const list = (await api.get("/api/platform/facilities")).body.facilities as { name: string; health: string; healthWhy: string[] }[];
    expect(list.find((f) => f.name === "Quiet Clinic")?.health).toBe("AT_RISK");
    expect(list.find((f) => f.name === "Quiet Clinic")?.healthWhy.join(" ")).toContain("No roster was published last month");
    expect(list.find((f) => f.name === "Busy Clinic")?.health).toBe("HEALTHY");
    expect((await api.get("/api/platform/dashboard")).body.atRisk).toBe(1);
    void quiet;
  });

  it("shows a facility's configuration and activity without any staff record", async () => {
    const api = await platform();
    const f = await makeFacility("Sombo Health Centre");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id });
    await as(admin).post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" });
    await prisma.staff.create({ data: { facilityId: f.id, staffNo: "S1", fullName: "Ama Dery", status: "ACTIVE" } });
    const body = (await api.get(`/api/platform/facilities/${f.id}`)).body;
    expect(body.configuration.shifts.map((s: { name: string }) => s.name)).toEqual(["Morning"]);
    expect(JSON.stringify(body)).not.toContain("Ama Dery");
    expect(body.usage.staffActive).toBe(1);
  });
});

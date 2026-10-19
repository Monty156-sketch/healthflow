import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function platform() {
  const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
  return as(user);
}
describe("the console is not there for anyone else", () => {
  it("answers not-found, as for a route that does not exist, to a facility administrator", async () => {
    const facility = await makeFacility();
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
    for (const path of ["/api/platform/dashboard", "/api/platform/facilities"]) {
      expect((await as(admin).get(path)).status).toBe(404);
    }
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

import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY);
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const nurse = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
  const people = [];
  for (let i = 1; i <= 17; i++) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: `S${String(i).padStart(2, "0")}`, fullName: `Nurse ${i}`, status: "ACTIVE", cadreId: nurse.id } }));
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean, minStaff: number) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff, colour: "#25619f" });
  await mk("A", "Morning", "08:00", "14:00", false, 3);
  await mk("M", "Afternoon", "14:00", "20:00", false, 2);
  await mk("N", "Night", "20:00", "08:00", true, 2);
  return { api, facility, admin, people };
}

describe("weekly rosters", () => {
  it("draws seven days into the monthly roster, leaves other days alone, and tells the people on it", async () => {
    const { api, facility, people } = await setup();
    // Everyone is on the roster; link a login to every nurse so the notices have somewhere to go.
    for (const p of people) {
      const { user } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: `Login ${p.staffNo}` } });
      await prisma.userProfile.update({ where: { id: user.id }, data: { staffId: p.id } });
    }
    const now = new Date();
    const roster = (await api.post("/api/facility/rosters", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })).body.roster as { id: string };
    await api.post(`/api/facility/rosters/${roster.id}/generate`);
    const from = today() + 1;
    const before = await prisma.rosterAssignment.count({ where: { rosterId: roster.id, dutyDate: { lt: new Date(from * DAY) } } });

    const shown = await api.get(`/api/facility/weekly-rosters?startDate=${iso(from)}`);
    expect(shown.status).toBe(200);
    const drawn = await api.post("/api/facility/weekly-rosters", { startDate: iso(from) });
    expect(drawn.status).toBe(201);
    expect(drawn.body.week.days).toHaveLength(7);
    expect(drawn.body.week.duties).toBeGreaterThan(0);
    expect(drawn.body.week.from).toBe(iso(from));
    // Days before the week are exactly as they were.
    expect(await prisma.rosterAssignment.count({ where: { rosterId: roster.id, dutyDate: { lt: new Date(from * DAY) } } })).toBe(before);
    expect(await prisma.notification.count({ where: { facilityId: facility.id, title: { startsWith: "Your duties for the week" } } })).toBeGreaterThan(0);
    expect((await api.get(`/api/facility/weekly-rosters?startDate=${iso(from)}`)).body.week.duties).toBe(drawn.body.week.duties);
  });

  it("starts a roster for the month when there is none, and refuses the past and ordinary staff", async () => {
    const { api, facility } = await setup();
    const from = today() + 2;
    expect((await api.post("/api/facility/weekly-rosters", { startDate: iso(from) })).status).toBe(201);
    expect(await prisma.roster.count({ where: { facilityId: facility.id } })).toBeGreaterThan(0);
    expect((await api.post("/api/facility/weekly-rosters", { startDate: iso(today() - 3) })).status).toBe(400);
    const { user: nurse } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Plain Nurse" } });
    expect((await as(nurse).post("/api/facility/weekly-rosters", { startDate: iso(from) })).status).toBe(403);
  });

  it("will not redraw a published month", async () => {
    const { api } = await setup();
    const from = today() + 1;
    expect((await api.post("/api/facility/weekly-rosters", { startDate: iso(from) })).status).toBe(201);
    await prisma.roster.updateMany({ data: { status: "PUBLISHED" } });
    const again = await api.post("/api/facility/weekly-rosters", { startDate: iso(from) });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("roster_locked");
  });
});

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
  const morning = (await mk("A", "Morning", "08:00", "14:00", false, 3)).body.shift;
  await mk("M", "Afternoon", "14:00", "20:00", false, 2);
  await mk("N", "Night", "20:00", "08:00", true, 2);
  const now = new Date();
  const roster = (await api.post("/api/facility/rosters", { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 })).body.roster as { id: string };
  await api.post(`/api/facility/rosters/${roster.id}/generate`);
  return { api, facility, people, morning, rosterId: roster.id };
}

describe("emergency deployments", () => {
  it("takes people off the usual roster for the dates, shares the emergency roster, and re-plans when they are back", async () => {
    const { api, people, morning, rosterId, facility } = await setup();
    const start = today();
    const end = start + 4;
    const chosen = people.slice(0, 3);
    const made = await api.post("/api/facility/deployments", {
      name: "National immunisation exercise", startDate: iso(start), endDate: iso(end), members: chosen.map((p) => ({ staffId: p.id, shiftId: morning.id })),
    });
    expect(made.status).toBe(201);

    // None of them keeps a duty in the usual roster inside the window.
    const stillOn = await prisma.rosterAssignment.count({
      where: { rosterId, staffId: { in: chosen.map((p) => p.id) }, dutyDate: { gte: new Date(start * DAY), lte: new Date(end * DAY) }, shift: { countsAsDuty: true } },
    });
    expect(stillOn).toBe(0);

    // The emergency roster lists them on the morning shift, and they were told.
    const sheet = (await api.get(`/api/facility/deployments/${made.body.id}/roster`)).body;
    expect(sheet.rows.map((r: { name: string }) => r.name).sort()).toEqual(chosen.map((p) => p.fullName).sort());
    expect(sheet.rows.every((r: { shift: string }) => r.shift === "Morning")).toBe(true);
    expect(sheet.days).toHaveLength(5);

    // Nobody can be put on two open deployments.
    const again = await api.post("/api/facility/deployments", { name: "Second exercise", startDate: iso(start), endDate: iso(end), members: [{ staffId: chosen[0].id, shiftId: morning.id }] });
    expect(again.status).toBe(409);

    // They show as due back once the dates pass; confirming them back closes the deployment.
    const list = (await api.get("/api/facility/deployments")).body.deployments as { id: string; status: string; members: { id: string }[] }[];
    expect(list[0].status).toBe("ACTIVE");
    const back = await api.post(`/api/facility/deployments/${made.body.id}/back`, { memberIds: list[0].members.map((m) => m.id), date: iso(Math.max(start + 1, today())) });
    expect(back.status).toBe(200);
    expect(back.body.confirmed).toBe(3);
    expect((await prisma.deployment.findUniqueOrThrow({ where: { id: made.body.id } })).status).toBe("CLOSED");
    expect((await api.post(`/api/facility/deployments/${made.body.id}/back`, { memberIds: [list[0].members[0].id] })).status).toBe(409);
    void facility;
  });

  it("refuses a start in the past, a person who is not active, and an off-day shift", async () => {
    const { api, people, morning } = await setup();
    const off = await prisma.shift.findFirstOrThrow({ where: { countsAsDuty: false } }).catch(() => null);
    const bad = await api.post("/api/facility/deployments", { name: "Old exercise", startDate: iso(today() - 3), endDate: iso(today()), members: [{ staffId: people[0].id, shiftId: morning.id }] });
    expect(bad.status).toBe(400);
    await prisma.staff.update({ where: { id: people[1].id }, data: { status: "INACTIVE" } });
    expect((await api.post("/api/facility/deployments", { name: "Real exercise", startDate: iso(today()), endDate: iso(today() + 2), members: [{ staffId: people[1].id, shiftId: morning.id }] })).status).toBe(400);
    if (off) expect((await api.post("/api/facility/deployments", { name: "Real exercise", startDate: iso(today()), endDate: iso(today() + 2), members: [{ staffId: people[0].id, shiftId: off.id }] })).status).toBe(400);
  });
});

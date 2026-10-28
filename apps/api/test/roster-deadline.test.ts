import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { daysToDeadline, deadlineOf, isLate, runRosterDeadlineReminders, stageFor } from "../src/lib/rosterDeadline.js";

beforeEach(resetDatabase);

describe("deadline arithmetic", () => {
  it("puts the deadline in the month before, to the end of the chosen day", () => {
    expect(deadlineOf(2026, 11, 25).toISOString()).toBe("2026-10-25T23:59:59.999Z");
    expect(deadlineOf(2027, 1, 25).toISOString()).toBe("2026-12-25T23:59:59.999Z");
  });
  it("counts days and picks the stage", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    expect(daysToDeadline(2026, 11, 25, now)).toBe(3);
    expect([stageFor(10), stageFor(7), stageFor(3), stageFor(1), stageFor(0), stageFor(-1)]).toEqual([0, 7, 3, 1, 1, -1]);
  });
  it("calls a roster late only when published after the deadline day", () => {
    expect(isLate(new Date("2026-10-25T22:00:00Z"), 2026, 11, 25)).toBe(false);
    expect(isLate(new Date("2026-10-26T00:30:00Z"), 2026, 11, 25)).toBe(true);
    expect(isLate(new Date("2026-10-30T00:00:00Z"), 2026, 11, null)).toBe(false);
  });
});

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  await prisma.facility.update({ where: { id: facility.id }, data: { status: "ACTIVE" } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  return { facility, admin, api: as(admin) };
}

describe("roster publishing deadline", () => {
  it("is set by the administrator within 1 to 28 and can be removed", async () => {
    const { api, facility } = await setup();
    expect((await api.put("/api/facility/roster-deadline", { day: 31 })).status).toBe(400);
    expect((await api.put("/api/facility/roster-deadline", { day: 25 })).status).toBe(200);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: facility.id } })).rosterDeadlineDay).toBe(25);
    const view = (await api.get("/api/facility/roster-deadline")).body;
    expect(view.day).toBe(25);
    expect(view.standing.length).toBe(2);
    expect(view.standing[0].status).toBe("not started");
    expect((await api.put("/api/facility/roster-deadline", { day: null })).status).toBe(200);
    expect((await api.get("/api/facility/roster-deadline")).body.standing).toEqual([]);
    const { user: staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Plain Nurse" } });
    expect((await as(staff).put("/api/facility/roster-deadline", { day: 10 })).status).toBe(403);
  });

  it("reminds once per stage, again when overdue, and stops once published", async () => {
    const { api, facility, admin } = await setup();
    await api.put("/api/facility/roster-deadline", { day: 25 });
    // 3 days before the deadline for the coming month.
    const now = new Date("2026-10-22T09:00:00Z");
    const next = { year: 2026, month: 11 };
    expect(await runRosterDeadlineReminders(now)).toBe(1);
    expect(await runRosterDeadlineReminders(now)).toBe(0);
    const mine = await prisma.notification.findMany({ where: { recipientEmail: admin.userEmail, type: "roster_deadline" } });
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toContain("November 2026");
    // Nearer the date a new stage fires.
    expect(await runRosterDeadlineReminders(new Date("2026-10-25T09:00:00Z"))).toBe(1);
    // After the deadline, once, and the administrator is told.
    expect(await runRosterDeadlineReminders(new Date("2026-10-27T09:00:00Z"))).toBe(1);
    expect(await runRosterDeadlineReminders(new Date("2026-10-28T09:00:00Z"))).toBe(0);
    // Published rosters are left alone.
    await prisma.roster.create({ data: { facilityId: facility.id, ...next, status: "PUBLISHED", publishedAt: new Date() } });
    await prisma.rosterDeadlineReminder.deleteMany({});
    expect(await runRosterDeadlineReminders(new Date("2026-10-27T09:00:00Z"))).toBe(0);
  });

  it("records a roster published after the deadline as late", async () => {
    const { api, facility } = await setup();
    await api.put("/api/facility/roster-deadline", { day: 1 });
    // Any roster published now is past day 1 of last month.
    const now = new Date();
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "APPROVED" } });
    const res = await api.post(`/api/facility/rosters/${roster.id}/status`, { action: "publish" });
    expect(res.status).toBe(200);
    expect((await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })).publishedLate).toBe(true);
    const view = (await api.get("/api/facility/roster-deadline")).body;
    expect(view.late).toHaveLength(1);
    expect(view.standing.find((s: { month: number }) => s.month === now.getUTCMonth() + 1).state).toBe("PUBLISHED_LATE");
  });
});

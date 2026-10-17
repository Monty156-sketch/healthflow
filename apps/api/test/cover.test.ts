import { beforeEach, describe, expect, it } from "vitest";
import { settleAgainstRoster, settlementFor } from "../src/lib/ledger.js";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const day = (offset: number) => new Date(Math.floor(Date.now() / 86_400_000 + offset) * 86_400_000);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
  const api = as(admin);
  const shift = (await api.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
  const other = (await api.post("/api/facility/shifts", { name: "Afternoon", code: "M", startTime: "14:00", endTime: "20:00", isOvernight: false, minStaff: 1, colour: "#b56b12" })).body.shift;
  const people = [];
  for (const n of ["Ama Dery", "Esi Naa", "Yaw Boah"]) people.push(await prisma.staff.create({ data: { facilityId: facility.id, staffNo: n, fullName: n, status: "ACTIVE" } }));
  const d = day(5);
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), status: "PUBLISHED" } });
  const mk = (staffId: string, shiftId: string, dt: Date) => prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId, shiftId, dutyDate: dt } });
  const duty = await mk(people[0].id, shift.id, d);
  await mk(people[1].id, other.id, day(6));
  const logins = new Map<string, ReturnType<typeof as>>();
  const login = async (staffId: string) => {
    const known = logins.get(staffId);
    if (known) return known;
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { staffId } });
    logins.set(staffId, as(user));
    return logins.get(staffId)!;
  };
  return { facility, api, people, roster, duty, login };
}

describe("the ledger", () => {
  it("a handover swap writes a matched pair, and an exchange writes none", async () => {
    const { api, people, duty, login } = await setup();
    const ama = await login(people[0].id);
    const yaw = await login(people[2].id);
    const id = (await ama.post("/api/facility/swaps", { assignmentId: duty.id, targetStaffId: people[2].id })).body.swap.id;
    await yaw.post(`/api/facility/swaps/${id}/respond`, { accept: true });
    await api.post(`/api/facility/swaps/${id}/decide`, { decision: "approve" });
    const l = (await api.get("/api/facility/ledger")).body;
    expect(l.summary.line).toBe("Open debts 1 duty · open credits 1 duty · balanced");
    expect(l.people.find((p: { name: string }) => p.name === "Ama Dery")).toMatchObject({ owes: 1, owed: 0 });
    expect(l.people.find((p: { name: string }) => p.name === "Yaw Boah")).toMatchObject({ owes: 0, owed: 1 });
  });

  it("settles both sides together, writes both off together, and only an admin can write off", async () => {
    const { api, people, login } = await setup();
    const adj = await api.post("/api/facility/ledger/adjust", { debtorId: people[0].id, creditorId: people[1].id, duties: 2, note: "Agreed at the ward meeting" });
    expect(adj.status).toBe(201);
    expect((await api.post("/api/facility/ledger/adjust", { debtorId: people[0].id, creditorId: people[1].id, duties: 2, note: "short" })).status).toBe(400);
    const entries = (await api.get("/api/facility/ledger")).body.entries as { id: string; type: string; staffName: string }[];
    const debt = entries.find((e) => e.type === "DEBT")!;
    expect((await api.post(`/api/facility/ledger/entries/${debt.id}/settle`, { duties: 1 })).status).toBe(200);
    expect((await api.get("/api/facility/ledger")).body.summary.line).toBe("Open debts 1 duty · open credits 1 duty · balanced");
    expect((await api.post(`/api/facility/ledger/entries/${debt.id}/settle`, { duties: 5 })).status).toBe(400);
    const manager = await (async () => {
      const { user } = await makeUser({ role: "ROSTER_MANAGER", facilityId: (await prisma.staff.findUniqueOrThrow({ where: { id: people[0].id } })).facilityId });
      return as(user);
    })();
    expect((await manager.post(`/api/facility/ledger/entries/${debt.id}/write-off`, { reason: "Not an admin trying" })).status).toBe(403);
    expect((await api.post(`/api/facility/ledger/entries/${debt.id}/write-off`, { reason: "Ama transferred to another facility" })).status).toBe(200);
    const after = (await api.get("/api/facility/ledger")).body;
    expect(after.summary.line).toBe("Open debts 0 duties · open credits 0 duties · balanced");
    expect(after.entries.filter((e: { status: string }) => e.status === "WRITTEN_OFF")).toHaveLength(2);
    void login;
  });

  it("lets entries lapse after the expiry period", async () => {
    const { api, people } = await setup();
    await api.post("/api/facility/ledger/adjust", { debtorId: people[0].id, creditorId: people[1].id, duties: 1, note: "Old arrangement from spring" });
    await prisma.dutyLedgerEntry.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const l = (await api.get("/api/facility/ledger")).body;
    expect(l.summary.openDebts).toBe(0);
    expect(l.entries.every((e: { status: string }) => e.status === "EXPIRED")).toBe(true);
  });
});

describe("settling the ledger", () => {
  it("feeds the next roster with what people owe, held to the monthly limit", async () => {
    const { api, people, facility } = await setup();
    await api.post("/api/facility/ledger/adjust", { debtorId: people[0].id, creditorId: people[1].id, duties: 9, note: "Agreed at the ward meeting" });
    const s = await settlementFor(facility.id);
    expect(s[people[0].id]).toBe(4); // capped at the facility's monthly limit
    expect(s[people[1].id]).toBe(-4);
  });

  it("settles debts against the extra duties people worked, once, when a roster is published", async () => {
    const { api, people, facility, roster } = await setup();
    const shift = await prisma.shift.findFirstOrThrow({ where: { facilityId: facility.id, code: "A" } });
    for (const d of [20, 21, 22]) await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: people[0].id, shiftId: shift.id, dutyDate: day(d) } });
    await api.post("/api/facility/ledger/adjust", { debtorId: people[0].id, creditorId: people[2].id, duties: 3, note: "Agreed at the ward meeting" });
    expect(await settleAgainstRoster(facility.id, roster.id, "kofi@example.com")).toBe(2);
    expect(await settleAgainstRoster(facility.id, roster.id, "kofi@example.com")).toBe(0);
    const l = (await api.get("/api/facility/ledger")).body;
    expect(l.people.find((p: { name: string }) => p.name === "Ama Dery")).toMatchObject({ owes: 1 });
    expect(l.people.find((p: { name: string }) => p.name === "Yaw Boah")).toMatchObject({ owed: 1 });
    expect(l.summary.balanced).toBe(true);
  });
});

describe("cover for an absence", () => {
  it("ranks the lawful people with reasons, keeps the list, and does not move anything until asked", async () => {
    const { api, people, duty } = await setup();
    const r = await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`);
    expect(r.status).toBe(200);
    expect(r.body.options.length).toBeGreaterThanOrEqual(2);
    expect(r.body.options.every((o: { reasons: string[] }) => o.reasons.length > 0)).toBe(true);
    expect(r.body.options[0].name).not.toBe("Esi Naa"); // she already has a duty and sits above average
    expect(await prisma.coverProposal.count({ where: { rosterAssignmentId: duty.id, status: "PROPOSED" } })).toBe(r.body.options.length);
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId).toBe(people[0].id);
  });

  it("ranks someone who owes the ledger above someone who does not", async () => {
    const { api, people, duty } = await setup();
    await api.post("/api/facility/ledger/adjust", { debtorId: people[2].id, creditorId: people[1].id, duties: 2, note: "Worked back from last month" });
    const r = await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`);
    expect(r.body.options[0].name).toBe("Yaw Boah");
    expect(r.body.options[0].reasons.join(" ")).toMatch(/owes 2 duties to the ledger/);
  });

  it("adds a little to someone who has said they are willing to cover extra duties", async () => {
    const { api, people, duty } = await setup();
    const score = async () => (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options.find((o: { name: string }) => o.name === "Yaw Boah");
    const before = await score();
    await prisma.staff.update({ where: { id: people[2].id }, data: { willingForExtraDuties: true } });
    const after = await score();
    expect(after.score - before.score).toBe(2);
    expect(after.reasons.join(" ")).toMatch(/willing to cover extra duties/);
  });

  it("assigns, waits for confirmation, and writes the ledger pair only when it is confirmed", async () => {
    const { api, people, duty, login } = await setup();
    await api.post("/api/facility/ledger/adjust", { debtorId: people[2].id, creditorId: people[1].id, duties: 1, note: "Worked back from last month" });
    const opts = (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options;
    const yaw = opts.find((o: { name: string }) => o.name === "Yaw Boah");
    const me = await login(people[2].id);
    const before = (await api.get("/api/facility/ledger")).body.entries.length;
    expect((await api.post("/api/facility/cover/assign", { assignmentId: duty.id, proposalId: yaw.proposalId, owedBack: true })).status).toBe(200);
    const row = await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } });
    expect(row).toMatchObject({ staffId: people[2].id, isCover: true, coverForStaffId: people[0].id, source: "COVER", acknowledgementState: "AWAITING" });
    expect((await api.get("/api/facility/ledger")).body.entries).toHaveLength(before);
    expect((await me.get("/api/facility/notifications")).body.notifications.some((n: { type: string }) => n.type === "cover_asked")).toBe(true);
    expect((await me.post(`/api/facility/cover/${duty.id}/respond`, { accept: true })).body.outcome).toBe("confirmed");
    const ledger = (await api.get("/api/facility/ledger")).body;
    expect(ledger.people.find((p: { name: string }) => p.name === "Ama Dery")).toMatchObject({ owes: 1 });
    expect((await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).acknowledgementState).toBe("CONFIRMED");
  });

  it("does not write a debt when the absence is not owed back", async () => {
    const { api, duty, login, people } = await setup();
    const opts = (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options;
    for (const p of people) await login(p.id);
    await api.post("/api/facility/cover/assign", { assignmentId: duty.id, proposalId: opts[0].proposalId, owedBack: false });
    const holder = (await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId;
    expect(holder).not.toBe(people[0].id);
    await (await login(holder)).post(`/api/facility/cover/${duty.id}/respond`, { accept: true });
    expect((await api.get("/api/facility/ledger")).body.entries).toHaveLength(0);
  });

  it("moves to the next-ranked person when someone declines, and leaves the duty unfilled when nobody is left", async () => {
    const { api, duty, login, people } = await setup();
    const opts = (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options as unknown[];
    for (const p of people) await login(p.id);
    await api.post("/api/facility/cover/assign", { assignmentId: duty.id, proposalId: (opts[0] as { proposalId: string }).proposalId, owedBack: true });
    const first = (await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId;
    const short = await (await login(first)).post(`/api/facility/cover/${duty.id}/respond`, { accept: false, reason: "no" });
    expect(short.status).toBe(400);
    let outcome = "";
    let moves = 0;
    for (let i = 0; i < 6 && outcome !== "unfilled"; i++) {
      const holder = (await prisma.rosterAssignment.findUniqueOrThrow({ where: { id: duty.id } })).staffId;
      const r = await (await login(holder)).post(`/api/facility/cover/${duty.id}/respond`, { accept: false, reason: "I am on a course that day" });
      expect(r.status).toBe(200);
      outcome = r.body.outcome;
      if (outcome === "moved") moves++;
    }
    expect(moves).toBe(opts.length - 1);
    expect(outcome).toBe("unfilled");
    expect(await prisma.rosterAssignment.findUnique({ where: { id: duty.id } })).toBeNull();
    expect(await prisma.notification.count({ where: { type: "cover_unfilled" } })).toBe(1);
    expect((await api.get("/api/facility/ledger")).body.entries).toHaveLength(0);
  });

  it("escalates cover nobody has confirmed within the window, once", async () => {
    const { api, duty } = await setup();
    const opts = (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options;
    await api.post("/api/facility/cover/assign", { assignmentId: duty.id, proposalId: opts[0].proposalId, owedBack: false });
    await prisma.rosterAssignment.update({ where: { id: duty.id }, data: { notifiedAt: new Date(Date.now() - 6 * 3_600_000) } });
    const a = await api.get("/api/facility/cover/awaiting");
    expect(a.body.cover[0].state).toBe("ESCALATED");
    await api.get("/api/facility/cover/awaiting");
    expect(await prisma.notification.count({ where: { type: "cover_unconfirmed" } })).toBe(1);
  });

  it("refuses a duty in the past, an unpublished roster, and an option that is no longer lawful", async () => {
    const { api, facility, people, duty, roster } = await setup();
    const opts = (await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).body.options;
    const target = opts[0];
    const type = await prisma.leaveType.create({ data: { facilityId: facility.id, code: "L", name: "Annual", sortOrder: 1 } });
    await prisma.leaveRequest.create({ data: { facilityId: facility.id, staffId: target.staffId, leaveTypeId: type.id, startDate: day(5), endDate: day(5), daysDeducted: 1, status: "APPROVED" } });
    const r = await api.post("/api/facility/cover/assign", { assignmentId: duty.id, proposalId: target.proposalId, owedBack: false });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/can no longer take this duty/);
    await prisma.rosterAssignment.update({ where: { id: duty.id }, data: { dutyDate: day(-3) } });
    expect((await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).status).toBe(409);
    await prisma.rosterAssignment.update({ where: { id: duty.id }, data: { dutyDate: day(5) } });
    await prisma.roster.update({ where: { id: roster.id }, data: { status: "APPROVED" } });
    expect((await api.get(`/api/facility/cover/options?assignmentId=${duty.id}`)).status).toBe(409);
    void people;
  });
});

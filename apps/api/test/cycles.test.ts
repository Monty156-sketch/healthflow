import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const midwife = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife", sortOrder: 1 } });
  return { facility, admin, api, midwife };
}

/** The spec's three starting shifts, each needing one midwife. */
async function shiftsNeedingMidwives(api: ReturnType<typeof as>, midwifeId: string) {
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean) =>
    api.post("/api/facility/shifts", {
      name, code, startTime, endTime, isOvernight, minStaff: 3, minByCadre: { [midwifeId]: 1 }, eligibleCadreIds: [], colour: "#25619f",
    });
  const a = (await mk("A", "Morning", "08:00", "14:00", false)).body.shift;
  const m = (await mk("M", "Afternoon", "14:00", "20:00", false)).body.shift;
  const n = (await mk("N", "Night", "20:00", "08:00", true)).body.shift;
  return { a, m, n };
}

describe("duty cycle rules", () => {
  it("saves the shift after a rest and the block order, and rejects shifts from elsewhere", async () => {
    const { api, midwife } = await setup();
    const { a, m, n } = await shiftsNeedingMidwives(api, midwife.id);
    const base = { name: "Custom", countingShiftIds: [n.id], consecutiveDuties: 3, offDaysRequired: 2, offDaysConsecutive: true, applicableCadreIds: [], applicableDepartmentIds: [], enforcement: "PREFER" };
    const ok = await api.post("/api/facility/cycles", { ...base, nextShiftAfterRestId: a.id, blockShiftPatternIds: [a.id, m.id, a.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.rule.nextShiftAfterRestId).toBe(a.id);
    expect(ok.body.rule.blockShiftPatternIds).toEqual([a.id, m.id, a.id]);
    const bad = await api.post("/api/facility/cycles", { ...base, name: "Bad", nextShiftAfterRestId: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.nextShiftAfterRestId).toBeTruthy();
  });

  it("seeds the two starting rules, all preferring, with the right counting shifts", async () => {
    const { api, midwife } = await setup();
    expect((await api.get("/api/facility/cycles")).body.rules).toHaveLength(0);
    const { a, m, n } = await shiftsNeedingMidwives(api, midwife.id);
    const { rules } = (await api.get("/api/facility/cycles")).body;
    expect(rules.map((r: { name: string }) => r.name)).toEqual(["4 nights on, 3 off", "4 days on, 1 off"]);
    expect(rules.every((r: { enforcement: string }) => r.enforcement === "PREFER")).toBe(true);
    expect(rules[0].countingShiftIds).toEqual([n.id]);
    expect(rules[1].countingShiftIds.sort()).toEqual([a.id, m.id].sort());
    expect(rules.map((r: { priority: number }) => r.priority)).toEqual([1, 2]);
    // the night rule sends people back on Afternoon; the day rule alternates Afternoon, Morning
    expect(rules[0].nextShiftAfterRestId).toBe(m.id);
    expect(rules[1].blockShiftPatternIds).toEqual([m.id, a.id]);
    // reading again does not seed twice
    expect((await api.get("/api/facility/cycles")).body.rules).toHaveLength(2);
  });

  it("says where a cycle asks for more than the facility's own rules allow", async () => {
    const { api, midwife, facility } = await setup();
    await shiftsNeedingMidwives(api, midwife.id);
    await api.get("/api/facility/rules");
    // Four 12-hour nights are 48 hours in a week, above the 40-hour limit.
    let checks = (await api.get("/api/facility/cycles")).body.checks as string[];
    expect(checks.some((c) => c.includes("48 hours in a week"))).toBe(true);
    expect(checks.some((c) => c.includes("nights in a row"))).toBe(false);
    await prisma.constraintRule.updateMany({ where: { facilityId: facility.id, code: "C8" }, data: { thresholdValue: 3 } });
    checks = (await api.get("/api/facility/cycles")).body.checks as string[];
    expect(checks.some((c) => c.includes("asks for 4 nights in a row, but Maximum consecutive night duties is 3"))).toBe(true);
  });

  it("switching to Block needs confirmation; priorities must be unique", async () => {
    const { api, midwife, facility } = await setup();
    await shiftsNeedingMidwives(api, midwife.id);
    const rule = (await api.get("/api/facility/cycles")).body.rules[0];
    const body = { ...rule, enforcement: "BLOCK" };
    const unconfirmed = await api.patch(`/api/facility/cycles/${rule.id}`, body);
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("block_confirm_needed");
    const ok = await api.patch(`/api/facility/cycles/${rule.id}`, { ...body, confirmBlock: true });
    expect(ok.status).toBe(200);
    expect(ok.body.rule.enforcement).toBe("BLOCK");
    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "cycle_rule_updated" } });
    expect(audit?.summary).toBe(
      'Kofi Bawa changed the duty cycle rule "4 nights on, 3 off" from after 4 consecutive duties, 3 days off, preferred to after 4 consecutive duties, 3 days off, enforced.'
    );
    const clash = await api.patch(`/api/facility/cycles/${rule.id}`, { ...body, confirmBlock: true, priority: 2 });
    expect(clash.status).toBe(400);
    expect(clash.body.fields.priority).toMatch(/already has priority 2/);
  });

  it("checks the numbers and that shifts, cadres and departments are the facility's own", async () => {
    const { api, midwife } = await setup();
    const { n } = await shiftsNeedingMidwives(api, midwife.id);
    await api.get("/api/facility/cycles"); // seeds the two starting rules
    const base = { name: "Custom", countingShiftIds: [n.id], consecutiveDuties: 3, offDaysRequired: 2, offDaysConsecutive: true, applicableCadreIds: [], applicableDepartmentIds: [], enforcement: "PREFER" };
    expect((await api.post("/api/facility/cycles", { ...base, consecutiveDuties: 0 })).body.fields.consecutiveDuties).toBe("At least 1.");
    expect((await api.post("/api/facility/cycles", { ...base, offDaysRequired: 9 })).body.fields.offDaysRequired).toBe("At most 7.");
    expect((await api.post("/api/facility/cycles", { ...base, countingShiftIds: [] })).body.fields.countingShiftIds).toMatch(/at least one shift/);
    const other = await setup();
    const foreign = (await other.api.post("/api/facility/shifts", { name: "Night", code: "N", startTime: "20:00", endTime: "08:00", isOvernight: true, minStaff: 1, colour: "#463a85" })).body.shift;
    expect((await api.post("/api/facility/cycles", { ...base, countingShiftIds: [foreign.id] })).body.fields.countingShiftIds).toMatch(/not a duty shift/);
    expect((await api.post("/api/facility/cycles", { ...base, applicableCadreIds: [other.midwife.id] })).body.fields.applicableCadreIds).toMatch(/not in your facility/);
    const ok = await api.post("/api/facility/cycles", base);
    expect(ok.status).toBe(201);
    expect(ok.body.rule.priority).toBe(3);
  });

  it("rules can be turned off or deleted, deleted presets stay gone, and a supervisor can read but not change them", async () => {
    const { api, midwife, facility } = await setup();
    await shiftsNeedingMidwives(api, midwife.id);
    const rule = (await api.get("/api/facility/cycles")).body.rules[1];
    expect((await api.patch(`/api/facility/cycles/${rule.id}/active`, { active: false })).body.rule.active).toBe(false);
    expect(await prisma.dutyCycleRule.count({ where: { id: rule.id } })).toBe(1);
    const { user } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(user).get("/api/facility/cycles")).status).toBe(200);
    expect((await as(user).patch(`/api/facility/cycles/${rule.id}/active`, { active: true })).status).toBe(403);
    expect((await as(user).delete(`/api/facility/cycles/${rule.id}`)).status).toBe(403);
    expect((await api.delete(`/api/facility/cycles/${rule.id}`)).status).toBe(200);
    expect(await prisma.dutyCycleRule.count({ where: { id: rule.id } })).toBe(0);
    expect((await api.delete(`/api/facility/cycles/${rule.id}`)).status).toBe(404);
    const left = (await api.get("/api/facility/cycles")).body.rules;
    expect(left).toHaveLength(1);
    await api.delete(`/api/facility/cycles/${left[0].id}`);
    expect((await api.get("/api/facility/cycles")).body.rules).toHaveLength(0);
  });
});

describe("capacity check", () => {
  async function withMidwives(count: number) {
    const s = await setup();
    await shiftsNeedingMidwives(s.api, s.midwife.id);
    await s.api.get("/api/facility/cycles"); // seeds the rules
    for (let i = 0; i < count; i++) {
      await prisma.staff.create({ data: { facilityId: s.facility.id, staffNo: `M${i}`, fullName: `Midwife ${i}`, status: "ACTIVE", cadreId: s.midwife.id } });
    }
    return s;
  }

  it("reports the spec's example: four midwives cannot cover three shifts under 4 on, 3 off", async () => {
    const { api, midwife } = await withMidwives(4);
    const cap = (await api.get("/api/facility/cycles/capacity?month=2026-10")).body;
    expect(cap.daysInMonth).toBe(31);
    const row = cap.cadres.find((c: { cadreId: string }) => c.cadreId === midwife.id);
    expect(row).toMatchObject({ staffCount: 4, supply: 71, demand: 93, shortBy: 22, achievable: false, staffNeeded: 2 });
    expect(row.rule.name).toBe("4 nights on, 3 off");
    expect(row.suggestion).toEqual({ consecutiveDuties: 4, offDaysRequired: 1 });
  });

  it("is achievable with enough staff, and deactivating the strictest rule loosens the bound", async () => {
    const { api, midwife } = await withMidwives(6);
    const first = (await api.get("/api/facility/cycles/capacity?month=2026-10")).body.cadres[0];
    expect(first).toMatchObject({ staffCount: 6, demand: 93, achievable: true, shortBy: 0 });
    const { api: api4, midwife: mw4 } = await withMidwives(4);
    const rules = (await api4.get("/api/facility/cycles")).body.rules;
    await api4.patch(`/api/facility/cycles/${rules[0].id}/active`, { active: false });
    const after = (await api4.get("/api/facility/cycles/capacity?month=2026-10")).body.cadres.find((c: { cadreId: string }) => c.cadreId === mw4.id);
    expect(after.rule.name).toBe("4 days on, 1 off");
  });

  it("only counts active staff", async () => {
    const { api, midwife, facility } = await withMidwives(4);
    await prisma.staff.updateMany({ where: { facilityId: facility.id, cadreId: midwife.id, staffNo: { in: ["M0", "M1"] } }, data: { status: "RESIGNED" } });
    const row = (await api.get("/api/facility/cycles/capacity?month=2026-10")).body.cadres[0];
    expect(row.staffCount).toBe(2);
  });
});

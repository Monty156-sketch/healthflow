import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const midwife = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Midwife" } });
  return { facility, admin, api: as(admin), midwife };
}

const NIGHT = { name: "Night", code: "n", startTime: "20:00", endTime: "08:00", isOvernight: true, minStaff: 3, minByCadre: {}, eligibleCadreIds: [], colour: "#463a85" };

describe("shifts", () => {
  it("every facility gets an Off Duty shift that cannot be turned off", async () => {
    const { api } = await setup();
    const list = await api.get("/api/facility/shifts");
    const off = list.body.shifts.find((s: { countsAsDuty: boolean }) => !s.countsAsDuty);
    expect(off.code).toBe("D/O");
    const res = await api.patch(`/api/facility/shifts/${off.id}/active`, { active: false });
    expect(res.status).toBe(409);
  });

  it("works out the duration, and refuses an overnight shift entered the wrong way round", async () => {
    const { api, facility } = await setup();
    const ok = await api.post("/api/facility/shifts", NIGHT);
    expect(ok.status).toBe(201);
    expect(ok.body.shift.durationHours).toBe(12);
    expect(ok.body.shift.code).toBe("N");

    const wrongWay = await api.post("/api/facility/shifts", { ...NIGHT, code: "N2", startTime: "08:00", endTime: "20:00" });
    expect(wrongWay.status).toBe(400);
    expect(wrongWay.body.fields.endTime).toMatch(/must be earlier than its start time/);

    const forgot = await api.post("/api/facility/shifts", { ...NIGHT, code: "N3", isOvernight: false });
    expect(forgot.body.fields.endTime).toMatch(/tick overnight/);

    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "shift_created" } });
    expect(audit?.summary).toBe("Kofi Bawa added the Night (N) shift, 20:00 to 08:00, 12 hours, overnight.");
  });

  it("codes are unique, and a cadre minimum cannot exceed the shift minimum", async () => {
    const { api, midwife } = await setup();
    await api.post("/api/facility/shifts", NIGHT);
    expect((await api.post("/api/facility/shifts", { ...NIGHT, name: "Another" })).body.fields.code).toMatch(/already uses/);
    const tooMany = await api.post("/api/facility/shifts", { ...NIGHT, code: "X", minByCadre: { [midwife.id]: 5 } });
    expect(tooMany.body.fields.minByCadre).toMatch(/cannot be more than/);
    const ok = await api.post("/api/facility/shifts", { ...NIGHT, code: "Y", minByCadre: { [midwife.id]: 1 } });
    expect(ok.status).toBe(201);
  });

  it("keeps weekend and public-holiday minimums, blank meaning the weekday number", async () => {
    const { api } = await setup();
    const made = await api.post("/api/facility/shifts", { ...NIGHT, weekendMinStaff: 2, holidayMinStaff: null });
    expect(made.status).toBe(201);
    expect(made.body.shift).toMatchObject({ minStaff: 3, weekendMinStaff: 2, holidayMinStaff: null });
    const changed = await api.patch(`/api/facility/shifts/${made.body.shift.id}`, { ...NIGHT, weekendMinStaff: null, holidayMinStaff: 1 });
    expect(changed.body.shift).toMatchObject({ weekendMinStaff: null, holidayMinStaff: 1 });
    expect((await api.post("/api/facility/shifts", { ...NIGHT, code: "Z", weekendMinStaff: -1 })).status).toBe(400);
    const kept = await api.post("/api/facility/shifts", { ...NIGHT, code: "K", keepFull: 1 });
    expect(kept.body.shift.keepFull).toBe(1);
    expect((await api.post("/api/facility/shifts", { ...NIGHT, code: "K2", keepFull: 3 })).status).toBe(400);
  });

  it("an on-call factor needs the advice it is based on", async () => {
    const { api } = await setup();
    const oc = { ...NIGHT, code: "OC", name: "On Call", startTime: "17:00", isOnCall: true, minStaff: 0 };
    const bad = await api.post("/api/facility/shifts", { ...oc, onCallHoursFactor: 0.5 });
    expect(bad.body.fields.onCallAdviceNote).toMatch(/Record the advice/);
    const ok = await api.post("/api/facility/shifts", { ...oc, onCallHoursFactor: 0.5, onCallAdviceNote: "Advice of Mr Tia, labour lawyer" });
    expect(ok.status).toBe(201);
    expect(ok.body.shift.durationHours).toBe(15);
    expect(ok.body.shift.onCallAdviceNote).toBe("Advice of Mr Tia, labour lawyer");
  });

  it("the starter adds three shifts once, and a supervisor cannot change shifts", async () => {
    const { api, facility } = await setup();
    expect((await api.post("/api/facility/shifts/starter")).status).toBe(201);
    expect((await api.post("/api/facility/shifts/starter")).status).toBe(409);
    const list = await api.get("/api/facility/shifts");
    expect(list.body.shifts.filter((s: { countsAsDuty: boolean }) => s.countsAsDuty).map((s: { code: string }) => s.code)).toEqual(["A", "M", "N"]);
    const { user } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(user).get("/api/facility/shifts")).status).toBe(200);
    expect((await as(user).post("/api/facility/shifts", NIGHT)).status).toBe(403);
  });

  it("deactivating keeps the shift; facilities cannot touch each other's shifts", async () => {
    const { api } = await setup();
    const id = (await api.post("/api/facility/shifts", NIGHT)).body.shift.id;
    expect((await api.patch(`/api/facility/shifts/${id}/active`, { active: false })).body.shift.active).toBe(false);
    expect(await prisma.shift.count({ where: { id } })).toBe(1);
    const other = await setup();
    expect((await other.api.patch(`/api/facility/shifts/${id}`, NIGHT)).status).toBe(404);
  });
});

describe("constraint rules", () => {
  it("seeds the fourteen rules with the spec's values", async () => {
    const { api } = await setup();
    const { rules } = (await api.get("/api/facility/rules")).body;
    expect(rules.map((r: { code: string }) => r.code)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"]);
    const by = (c: string) => rules.find((r: { code: string }) => r.code === c);
    expect(by("C2")).toMatchObject({ ruleType: "STATUTORY", thresholdValue: 40, behaviour: "WARN" });
    expect(by("C3")).toMatchObject({ thresholdValue: 48, behaviour: "BLOCK" });
    expect(by("C5")).toMatchObject({ ruleType: "POLICY", thresholdValue: 11, behaviour: "BLOCK" });
    expect(by("C6").overridable).toBe(false);
    expect(by("C12").behaviour).toBe("OPTIMISE");
  });

  it("moves an untouched night limit of 3 to the new standard of 4, once, and leaves one the facility chose", async () => {
    const { api, facility } = await setup();
    await api.get("/api/facility/rules");
    const c8 = await prisma.constraintRule.findFirstOrThrow({ where: { facilityId: facility.id, code: "C8" } });
    expect(c8.thresholdValue).toBe(4);
    await prisma.constraintRule.update({ where: { id: c8.id }, data: { thresholdValue: 3 } });
    await api.get("/api/facility/rules");
    expect((await prisma.constraintRule.findUniqueOrThrow({ where: { id: c8.id } })).thresholdValue).toBe(4);
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "rule_standard_raised" } })).toBe(1);
    // Once raised it is never raised again, so a facility that sets 3 itself keeps it.
    await prisma.constraintRule.update({ where: { id: c8.id }, data: { thresholdValue: 3 } });
    await api.get("/api/facility/rules");
    expect((await prisma.constraintRule.findUniqueOrThrow({ where: { id: c8.id } })).thresholdValue).toBe(3);
  });

  it("logical rules cannot be changed or turned off", async () => {
    const { api } = await setup();
    for (const code of ["C6", "C9"]) {
      const res = await api.patch(`/api/facility/rules/${code}`, { enabled: false });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("rule_locked");
    }
  });

  it("a statutory threshold changes only after the warning is confirmed and the advice recorded", async () => {
    const { api, facility } = await setup();
    const unconfirmed = await api.patch("/api/facility/rules/C2", { thresholdValue: 45 });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("statutory_confirm_needed");
    const noReason = await api.patch("/api/facility/rules/C2", { thresholdValue: 45, confirmStatutory: true });
    expect(noReason.body.fields.reason).toMatch(/Record the advice/);
    const ok = await api.patch("/api/facility/rules/C2", { thresholdValue: 45, confirmStatutory: true, reason: "Collective agreement, 2026" });
    expect(ok.status).toBe(200);
    expect(ok.body.rule.thresholdValue).toBe(45);
    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "rule_updated" } });
    expect(audit?.summary).toBe(
      "Kofi Bawa changed rule C2 (Maximum normal hours per week): threshold from 40 to 45 hours. Advice recorded: Collective agreement, 2026"
    );
    expect((await api.patch("/api/facility/rules/C2", { enabled: false })).status).toBe(409);
    expect((await api.patch("/api/facility/rules/C2", { behaviour: "BLOCK" })).status).toBe(409);
  });

  it("policy rules can change threshold, behaviour and be turned off; ranges are enforced", async () => {
    const { api } = await setup();
    const res = await api.patch("/api/facility/rules/C5", { thresholdValue: 10, behaviour: "WARN" });
    expect(res.body.rule).toMatchObject({ thresholdValue: 10, behaviour: "WARN" });
    expect((await api.patch("/api/facility/rules/C5", { enabled: false })).body.rule.enabled).toBe(false);
    const out = await api.patch("/api/facility/rules/C5", { thresholdValue: 40 });
    expect(out.status).toBe(400);
    expect(out.body.fields.thresholdValue).toMatch(/from 1 to 24/);
  });

  it("each facility has its own rules", async () => {
    const a = await setup();
    const b = await setup();
    await a.api.patch("/api/facility/rules/C7", { thresholdValue: 5 });
    const seenByB = (await b.api.get("/api/facility/rules")).body.rules.find((r: { code: string }) => r.code === "C7");
    expect(seenByB.thresholdValue).toBe(6);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { runCredentialReminders, stageFor, stateOf } from "../src/lib/credentials.js";

beforeEach(resetDatabase);

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const { user: nurseUser, staff: nurse } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Nurse" } });
  return { facility, admin, api: as(admin), nurseUser, nurseApi: as(nurseUser), nurseId: nurse!.id };
}

describe("credential states", () => {
  it("works out where a date stands", () => {
    const d = (n: number) => new Date(Date.now() + n * 86_400_000);
    expect(stateOf({ expiresOn: d(-3), noExpiry: false }).state).toBe("EXPIRED");
    expect(stateOf({ expiresOn: d(20), noExpiry: false }).state).toBe("EXPIRING");
    expect(stateOf({ expiresOn: d(200), noExpiry: false }).state).toBe("VALID");
    expect(stateOf({ expiresOn: null, noExpiry: true }).state).toBe("NO_EXPIRY");
    expect([stageFor(80), stageFor(55), stageFor(25), stageFor(5), stageFor(-1), stageFor(null)]).toEqual([0, 60, 30, 7, -1, 0]);
  });
});

describe("licences and certificates", () => {
  it("lets the administrator record one, checked at once, and lists what needs attention", async () => {
    const { api, nurseId } = await setup();
    const res = await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Nursing and Midwifery Council licence", number: "RN123", expiresOn: iso(20), noExpiry: false });
    expect(res.status).toBe(201);
    expect(res.body.credential.verified).toBe(true);
    expect(res.body.credential.state).toBe("EXPIRING");
    await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Basic life support", expiresOn: iso(300), noExpiry: false });
    const list = await api.get("/api/facility/credentials");
    expect(list.body.credentials.map((c: { kind: string }) => c.kind)).toEqual(["Nursing and Midwifery Council licence"]);
    expect((await api.get("/api/facility/credentials?filter=all")).body.credentials).toHaveLength(2);
    const summary = (await api.get("/api/facility/credentials/summary")).body;
    expect(summary.expiring).toBe(1);
    expect(summary.expired).toBe(0);
  });

  it("asks for a date unless the certificate does not lapse, and rejects a date before issue", async () => {
    const { api, nurseId } = await setup();
    const none = await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Fire safety training" });
    expect(none.status).toBe(400);
    expect(none.body.fields.expiresOn).toBeTruthy();
    const backwards = await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Fire safety training", issuedOn: "2026-05-01", expiresOn: "2026-04-01" });
    expect(backwards.status).toBe(400);
    const forever = await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Fire safety training", noExpiry: true });
    expect(forever.status).toBe(201);
    expect(forever.body.credential.state).toBe("NO_EXPIRY");
  });

  it("keeps a member of staff to their own record, unchecked until the administrator checks it", async () => {
    const { api, nurseApi, nurseId, facility } = await setup();
    const { user: other, staff: otherStaff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Yaw Other" } });
    const mine = await nurseApi.post("/api/facility/credentials", { staffId: otherStaff!.id, kind: "Basic life support", expiresOn: iso(90), noExpiry: false });
    expect(mine.status).toBe(201);
    // The staffId in the body is ignored for staff: it lands on their own record.
    expect(mine.body.credential.staffId).toBe(nurseId);
    expect(mine.body.credential.verified).toBe(false);
    expect((await nurseApi.get("/api/facility/credentials/mine")).body.credentials).toHaveLength(1);
    expect((await as(other).get("/api/facility/credentials/mine")).body.credentials).toHaveLength(0);
    // Staff cannot read the facility-wide list, change someone else's, or check their own.
    expect((await nurseApi.get("/api/facility/credentials")).status).toBe(403);
    expect((await as(other).put(`/api/facility/credentials/${mine.body.credential.id}`, { kind: "x1", expiresOn: iso(5), noExpiry: false })).status).toBe(404);
    expect((await nurseApi.post(`/api/facility/credentials/${mine.body.credential.id}/verify`)).status).toBe(403);
    const checked = await api.post(`/api/facility/credentials/${mine.body.credential.id}/verify`);
    expect(checked.body.credential.verified).toBe(true);
    // A change by the member of staff has to be checked again.
    const changed = await nurseApi.put(`/api/facility/credentials/${mine.body.credential.id}`, { kind: "Basic life support", expiresOn: iso(400), noExpiry: false });
    expect(changed.body.credential.verified).toBe(false);
  });

  it("lists who is missing something their cadre must hold", async () => {
    const { api, facility, nurseId } = await setup();
    const cadre = await prisma.cadre.create({ data: { facilityId: facility.id, name: "Nurse", code: "RN", sortOrder: 1 } });
    await prisma.staff.update({ where: { id: nurseId }, data: { cadreId: cadre.id } });
    expect((await api.put(`/api/facility/credentials/requirements/${cadre.id}`, { kinds: ["Nursing and Midwifery Council licence"] })).status).toBe(200);
    expect((await api.get("/api/facility/credentials/summary")).body.missingCount).toBe(1);
    await api.post("/api/facility/credentials", { staffId: nurseId, kind: "nursing and midwifery council licence", expiresOn: iso(-2), noExpiry: false });
    // A lapsed licence does not satisfy the requirement.
    expect((await api.get("/api/facility/credentials/summary")).body.missingCount).toBe(1);
    await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Nursing and Midwifery Council licence", expiresOn: iso(365), noExpiry: false });
    expect((await api.get("/api/facility/credentials/summary")).body.missingCount).toBe(0);
  });

  it("reminds once per stage, tells the managers, and starts again when the date changes", async () => {
    const { api, nurseId, nurseUser } = await setup();
    const made = await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Basic life support", expiresOn: iso(25), noExpiry: false });
    const id = made.body.credential.id as string;
    expect(await runCredentialReminders()).toBe(1);
    expect(await runCredentialReminders()).toBe(0);
    const mine = await prisma.notification.findMany({ where: { recipientEmail: nurseUser.userEmail, type: "credential_expiry" } });
    expect(mine).toHaveLength(1);
    expect(await prisma.notification.count({ where: { type: "credential_summary" } })).toBe(1);
    // A new date resets the stage, so the next approach is reminded again.
    await api.put(`/api/facility/credentials/${id}`, { kind: "Basic life support", expiresOn: iso(5), noExpiry: false });
    expect((await prisma.staffCredential.findUniqueOrThrow({ where: { id } })).remindedStage).toBe(0);
    expect(await runCredentialReminders()).toBe(1);
    // Removed credentials are never chased.
    await api.delete(`/api/facility/credentials/${id}`);
    await prisma.staffCredential.update({ where: { id }, data: { remindedStage: 0 } });
    expect(await runCredentialReminders()).toBe(0);
  });

  it("removes a person's licence numbers when they are moved out", async () => {
    const { api, facility, nurseId } = await setup();
    await api.post("/api/facility/credentials", { staffId: nurseId, kind: "Basic life support", expiresOn: iso(90), noExpiry: false });
    await prisma.$transaction(async (tx) => {
      const { scrubStaff } = await import("../src/routes/facility/staffMoves.js");
      await scrubStaff(tx, nurseId, "INACTIVE");
    });
    expect(await prisma.staffCredential.count({ where: { facilityId: facility.id } })).toBe(0);
  });
});

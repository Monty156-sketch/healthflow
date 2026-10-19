import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { notifyRosterPublished } from "../src/lib/rosterPublished.js";

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMS_API_KEY;
  delete process.env.SMS_SENDER_ID;
});

const configure = () => {
  process.env.SMS_API_KEY = "test-key";
  process.env.SMS_SENDER_ID = "HealthFlow";
};
const stubGateway = (ok = true) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok ? { status: "success" } : { status: "error", message: "Invalid sender" }), { status: ok ? 200 : 400 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

async function setup(smsEnabled = true) {
  const facility = await prisma.facility.create({ data: { name: "Sombo Health Centre", facilityType: "HEALTH_CENTRE", smsEnabled } });
  const shift = await prisma.shift.create({ data: { facilityId: facility.id, name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", durationHours: 6, countsAsDuty: true, colour: "#25619f", minStaff: 1 } });
  const ama = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "1", fullName: "Ama Dery", phone: "024 618 7422", status: "ACTIVE" } });
  const esi = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "2", fullName: "Esi Naa", phone: "0555555555", smsOptOut: true, status: "ACTIVE" } });
  const yaw = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "3", fullName: "Yaw Boah", phone: null, status: "ACTIVE" } });
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: 11, year: 2026, status: "PUBLISHED" } });
  for (const [i, s] of [ama, esi, yaw].entries()) {
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: s.id, shiftId: shift.id, dutyDate: new Date(Date.UTC(2026, 10, 3 + i)) } });
  }
  return { facility, roster, ama, esi, yaw };
}

describe("texting staff when a roster is published", () => {
  it("texts the person with a number who has not opted out, and records it", async () => {
    configure();
    const gateway = stubGateway();
    const { facility, roster, ama } = await setup();
    expect(await notifyRosterPublished(facility.id, roster.id)).toBe(3);
    expect(gateway).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((gateway.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.recipients).toEqual(["233246187422"]);
    expect(sent.message).toContain("Sombo Health Centre");
    expect(sent.message).toContain("November 2026");
    const rows = await prisma.smsMessage.findMany({ where: { facilityId: facility.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ staffId: ama.id, status: "SENT", type: "roster_published" });
  });

  it("sends nothing when the facility has not turned texting on", async () => {
    configure();
    const gateway = stubGateway();
    const { facility, roster } = await setup(false);
    await notifyRosterPublished(facility.id, roster.id);
    expect(gateway).not.toHaveBeenCalled();
    expect(await prisma.smsMessage.count()).toBe(0);
  });

  it("records a skipped text when the server has no SMS key", async () => {
    const gateway = stubGateway();
    const { facility, roster } = await setup();
    await notifyRosterPublished(facility.id, roster.id);
    expect(gateway).not.toHaveBeenCalled();
    const row = await prisma.smsMessage.findFirstOrThrow();
    expect(row.status).toBe("SKIPPED");
    expect(row.error).toContain("not set up");
  });

  it("records a failed text and does not stop the publication notice", async () => {
    configure();
    stubGateway(false);
    const { facility, roster } = await setup();
    await expect(notifyRosterPublished(facility.id, roster.id)).resolves.toBe(3);
    const row = await prisma.smsMessage.findFirstOrThrow();
    expect(row).toMatchObject({ status: "FAILED", error: "Invalid sender" });
  });

  it("also tells people who have an account, in the app", async () => {
    configure();
    stubGateway();
    const { facility, roster, ama } = await setup();
    await prisma.userProfile.create({ data: { userEmail: "ama@example.test", passwordHash: "x", role: "STAFF", scopeType: "FACILITY", scopeId: facility.id, facilityId: facility.id, staffId: ama.id } });
    await notifyRosterPublished(facility.id, roster.id);
    const note = await prisma.notification.findFirstOrThrow({ where: { facilityId: facility.id } });
    expect(note).toMatchObject({ type: "roster_published", recipientEmail: "ama@example.test" });
    expect(await prisma.smsMessage.count({ where: { status: "SENT" } })).toBe(1);
  });
});

describe("the facility's text message settings", () => {
  it("cannot be turned on before the server is set up, and then can", async () => {
    const facility = await makeFacility();
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
    const api = as(admin);
    const refused = await api.put("/api/facility/sms", { enabled: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("not_configured");
    configure();
    expect((await api.put("/api/facility/sms", { enabled: true })).status).toBe(200);
    const view = (await api.get("/api/facility/sms")).body;
    expect(view).toMatchObject({ configured: true, enabled: true });
    expect(await prisma.auditLog.count({ where: { facilityId: facility.id, action: "sms_enabled" } })).toBe(1);
  });

  it("is for administrators only, and counts who can be reached", async () => {
    const facility = await makeFacility();
    const { user: staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Dery" } });
    expect((await as(staff).get("/api/facility/sms")).status).toBe(403);
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
    await prisma.staff.updateMany({ where: { fullName: "Kofi Bawa" }, data: { phone: "0244000000" } });
    const view = (await as(admin).get("/api/facility/sms")).body;
    expect(view.reachable).toBe(1);
    expect(view.withoutNumber).toBe(1);
  });
});

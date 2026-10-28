import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { runWhatsappReminders } from "../src/lib/whatsapp.js";

beforeEach(resetDatabase);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const MORNING = new Date(new Date().toISOString().slice(0, 10) + "T07:00:00Z");

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  await prisma.facility.update({ where: { id: facility.id }, data: { status: "ACTIVE" } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const { user: nurseUser, staff: nurse } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Mensah" } });
  await prisma.staff.update({ where: { id: nurse!.id }, data: { phone: "0241234567" } });
  const night = await prisma.shift.create({ data: { facilityId: facility.id, name: "Night", code: "N", startTime: "20:00", endTime: "08:00", isOvernight: true } });
  const roster = await prisma.roster.create({ data: { facilityId: facility.id, year: MORNING.getUTCFullYear(), month: MORNING.getUTCMonth() + 1, status: "PUBLISHED" } });
  await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: nurse!.id, shiftId: night.id, dutyDate: new Date(MORNING.toISOString().slice(0, 10) + "T00:00:00Z") } });
  return { facility, api: as(admin), nurseApi: as(nurseUser), nurseId: nurse!.id };
}

const keys = () => { vi.stubEnv("WHATSAPP_TOKEN", "t"); vi.stubEnv("WHATSAPP_PHONE_ID", "123"); };
const okFetch = () => { const f = vi.fn(async () => Response.json({ messages: [{ id: "wamid.1" }] })); vi.stubGlobal("fetch", f); return f; };

describe("WhatsApp duty reminders", () => {
  it("does nothing without the server keys, and refuses to be switched on", async () => {
    const { api } = await setup();
    const f = okFetch();
    expect((await api.put("/api/facility/whatsapp", { enabled: true })).status).toBe(409);
    expect(await runWhatsappReminders(MORNING)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends nothing unless the facility is on and the person chose it, then sends once a day", async () => {
    const { api, nurseApi, nurseId } = await setup();
    keys();
    const f = okFetch();
    expect((await api.put("/api/facility/whatsapp", { enabled: true })).status).toBe(200);
    // Nobody has opted in yet.
    expect(await runWhatsappReminders(MORNING)).toBe(0);
    // The administrator cannot opt a person in; the person does it, after seeing the number.
    const view = (await nurseApi.get("/api/facility/me/whatsapp")).body;
    expect(view.number).toBe("ending 567");
    expect((await nurseApi.put("/api/facility/me/whatsapp", { optIn: true })).status).toBe(200);
    expect(await runWhatsappReminders(new Date(MORNING.getTime() - 3 * 3_600_000))).toBe(0); // too early (04:00)
    expect(await runWhatsappReminders(MORNING)).toBe(1);
    expect(await runWhatsappReminders(MORNING)).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.to).toBe("233241234567");
    expect(sent.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Ama", "Night (20:00 to 08:00)", "Sombo Health Centre"]);
    const row = await prisma.whatsappMessage.findFirstOrThrow({ where: { staffId: nurseId } });
    expect(row.status).toBe("SENT");
    expect((await api.get("/api/facility/whatsapp")).body.sent30).toBe(1);
  });

  it("tries a failed message again, three times at most, and skips people who opted out", async () => {
    const { api, nurseApi, nurseId } = await setup();
    keys();
    await api.put("/api/facility/whatsapp", { enabled: true });
    await nurseApi.put("/api/facility/me/whatsapp", { optIn: true });
    const bad = vi.fn(async () => Response.json({ error: { message: "Template not approved" } }, { status: 400 }));
    vi.stubGlobal("fetch", bad);
    for (let i = 0; i < 5; i++) await runWhatsappReminders(MORNING);
    expect(bad).toHaveBeenCalledTimes(3);
    const row = await prisma.whatsappMessage.findFirstOrThrow({ where: { staffId: nurseId } });
    expect([row.status, row.attempts, row.error]).toEqual(["FAILED", 3, "Template not approved"]);
    await prisma.whatsappMessage.deleteMany({});
    await nurseApi.put("/api/facility/me/whatsapp", { optIn: false });
    const f = okFetch();
    expect(await runWhatsappReminders(MORNING)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not remind about a roster that is not published, and needs a usable number to opt in", async () => {
    const { api, nurseApi, nurseId, facility } = await setup();
    keys();
    await api.put("/api/facility/whatsapp", { enabled: true });
    await nurseApi.put("/api/facility/me/whatsapp", { optIn: true });
    await prisma.roster.updateMany({ where: { facilityId: facility.id }, data: { status: "APPROVED" } });
    const f = okFetch();
    expect(await runWhatsappReminders(MORNING)).toBe(0);
    expect(f).not.toHaveBeenCalled();
    await prisma.staff.update({ where: { id: nurseId }, data: { phone: null, whatsappOptIn: false } });
    expect((await nurseApi.put("/api/facility/me/whatsapp", { optIn: true })).status).toBe(409);
  });
});

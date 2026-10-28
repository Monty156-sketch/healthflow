import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFacility, prisma, resetDatabase } from "./helpers.js";
import { notifyStaff } from "../src/lib/notify.js";

beforeEach(resetDatabase);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("notices to staff with no login", () => {
  it("texts them the notices that change their duties, and only those", async () => {
    vi.stubEnv("SMS_API_KEY", "k");
    vi.stubEnv("SMS_SENDER_ID", "HealthFlow");
    const f = vi.fn(async () => Response.json({ status: "success" }));
    vi.stubGlobal("fetch", f);
    const facility = await makeFacility("Sombo Health Centre");
    await prisma.facility.update({ where: { id: facility.id }, data: { smsEnabled: true } });
    const staff = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "W1", fullName: "Yaa No Login", status: "ACTIVE", phone: "0551112233" } });

    await notifyStaff(facility.id, staff.id, { type: "credential_expiry", title: "Your licence lapses in 7 days", body: "Renew it in good time and give your in-charge the new date." });
    expect(f).toHaveBeenCalledTimes(1);
    const row = await prisma.smsMessage.findFirstOrThrow({ where: { staffId: staff.id } });
    expect([row.type, row.status]).toEqual(["credential_expiry", "SENT"]);

    // Not a text-worthy notice: nothing goes out and nothing is invented.
    await notifyStaff(facility.id, staff.id, { type: "handover_urgent", title: "x", body: "y" });
    expect(f).toHaveBeenCalledTimes(1);

    // Someone who asked not to be texted is left alone.
    await prisma.staff.update({ where: { id: staff.id }, data: { smsOptOut: true } });
    await notifyStaff(facility.id, staff.id, { type: "credential_expiry", title: "t", body: "b" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

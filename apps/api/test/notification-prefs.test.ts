import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { notifyStaff } from "../src/lib/notify.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user, staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Mensah" } });
  return { facility, user, staffId: staff!.id };
}

describe("notification preferences", () => {
  it("lists what can be switched off, all on to begin with", async () => {
    const { user } = await setup();
    const res = await as(user).get("/api/facility/me/notification-preferences");
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: { key: string }) => c.key)).toEqual(["swaps", "cover", "leave"]);
    expect(res.body.categories.every((c: { on: boolean }) => c.on)).toBe(true);
    expect(res.body.alwaysSent.length).toBeGreaterThan(0);
  });

  it("stops the notifications switched off, never the ones about their own duties", async () => {
    const { user, facility, staffId } = await setup();
    const off = await as(user).put("/api/facility/me/notification-preferences", { off: ["swaps"] });
    expect(off.status).toBe(200);
    expect(off.body.categories.find((c: { key: string }) => c.key === "swaps").on).toBe(false);
    await notifyStaff(facility.id, staffId, { type: "swap_requested", title: "Swap?", body: "Someone asks you to swap." });
    await notifyStaff(facility.id, staffId, { type: "cover_asked", title: "Cover?", body: "You are asked to cover." });
    await notifyStaff(facility.id, staffId, { type: "duty_moved", title: "Moved", body: "Your duty has moved." });
    const types = (await prisma.notification.findMany({ where: { facilityId: facility.id } })).map((n) => n.type).sort();
    expect(types).toEqual(["cover_asked", "duty_moved"]);
    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "notification_preferences_changed" } });
    expect(audit?.summary).toBe("Ama Mensah switched off notifications about duty swaps.");
  });

  it("rejects a kind that cannot be switched off", async () => {
    const { user } = await setup();
    const res = await as(user).put("/api/facility/me/notification-preferences", { off: ["duty_moved"] });
    expect(res.status).toBe(400);
  });
});

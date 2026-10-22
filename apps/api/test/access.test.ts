import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { extendAfterPayment, runAccessJob } from "../src/lib/access.js";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());

const DAY = 86_400_000;

async function platform() {
  const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
  return as(user);
}

async function withPlan(facilityId: string, sub: { status?: "TRIAL" | "ACTIVE"; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null } = {}) {
  const plan = await prisma.plan.create({ data: { name: "Health centre", monthlyPriceGhs: 100, sortOrder: 1 } });
  return prisma.subscription.create({ data: { facilityId, planId: plan.id, status: sub.status ?? "TRIAL", trialEndsAt: sub.trialEndsAt ?? null, currentPeriodEnd: sub.currentPeriodEnd ?? null } });
}

describe("approving a new registration", () => {
  it("keeps a pending facility locked until approved, then opens it for a 30 day trial", async () => {
    const f = await makeFacility("New Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "PENDING" } });
    await withPlan(f.id);
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: "Ama Admin" } });
    const locked = await as(admin).get("/api/facility/staff");
    expect(locked.status).toBe(402);
    expect(locked.body.error).toBe("pending_approval");
    const state = (await as(admin).get("/api/facility/access")).body;
    expect(state).toMatchObject({ status: "PENDING", locked: true });

    const api = await platform();
    expect((await api.get("/api/platform/registrations")).body.pending.map((r: { name: string }) => r.name)).toEqual(["New Clinic"]);
    expect((await api.post(`/api/platform/facilities/${f.id}/approve`, {})).status).toBe(200);
    const after = await prisma.facility.findUniqueOrThrow({ where: { id: f.id }, include: { subscription: true } });
    expect(after.status).toBe("TRIAL");
    expect(Math.round((after.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(30);
    expect(after.subscription?.trialEndsAt).toEqual(after.trialEndsAt);
    expect((await as(admin).get("/api/facility/staff")).status).toBe(200);
    expect((await api.post(`/api/platform/facilities/${f.id}/approve`, {})).status).toBe(409);
  });

  it("declines with a reason the facility can read", async () => {
    const f = await makeFacility("Fake Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "PENDING" } });
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id });
    const api = await platform();
    expect((await api.post(`/api/platform/facilities/${f.id}/decline`, { reason: "x" })).status).toBe(400);
    expect((await api.post(`/api/platform/facilities/${f.id}/decline`, { reason: "We could not find this facility." })).status).toBe(200);
    const s = (await as(admin).get("/api/facility/access")).body;
    expect(s).toMatchObject({ status: "DECLINED", locked: true, note: "We could not find this facility." });
    expect((await as(admin).get("/api/facility/staff")).body.error).toBe("declined");
  });
});

describe("reminders and the lock", () => {
  it("reminds the administrator and in-charges in the last week, once a day, and issues the bill", async () => {
    const f = await makeFacility("Soon Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "TRIAL", trialEndsAt: new Date(Date.now() + 3 * DAY) } });
    await withPlan(f.id, { trialEndsAt: new Date(Date.now() + 3 * DAY), currentPeriodEnd: new Date(Date.now() + 3 * DAY) });
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: "Ama Admin" } });
    const { user: mgr } = await makeUser({ role: "ROSTER_MANAGER", facilityId: f.id, withStaff: { fullName: "Kofi Manager" } });
    const { user: nurse } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Efua Nurse" } });
    expect(await runAccessJob()).toEqual({ lapsed: 0, reminded: 1 });
    expect(await runAccessJob()).toEqual({ lapsed: 0, reminded: 0 });
    const notes = await prisma.notification.findMany({ where: { facilityId: f.id, type: "payment_due" } });
    expect(notes.map((n) => n.recipientEmail).sort()).toEqual([admin.userEmail, mgr.userEmail].sort());
    expect((await prisma.invoice.findMany({ where: { facilityId: f.id } })).map((i) => i.totalGhs)).toEqual([100]);
    expect((await as(admin).get("/api/facility/access")).body).toMatchObject({ reminder: true, daysLeft: 3, canPay: true });
    expect((await as(nurse).get("/api/facility/access")).body.reminder).toBe(false);
  });

  it("locks everyone when the date passes unpaid, leaves billing open, and reopens for a month on payment", async () => {
    const f = await makeFacility("Late Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) } });
    await withPlan(f.id, { trialEndsAt: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() - 1000) });
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: "Ama Admin" } });
    const { user: nurse } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Efua Nurse" } });
    expect(await runAccessJob()).toEqual({ lapsed: 1, reminded: 0 });
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("LAPSED");

    for (const who of [admin, nurse]) {
      const r = await as(who).get("/api/facility/staff");
      expect(r.status).toBe(402);
      expect(r.body.error).toBe("payment_required");
    }
    expect((await as(nurse).get("/api/facility/access")).body).toMatchObject({ locked: true, canPay: false, status: "LAPSED" });
    const bill = (await as(admin).get("/api/facility/billing")).body;
    expect(bill.invoices).toHaveLength(1);

    await extendAfterPayment(f.id);
    const after = await prisma.facility.findUniqueOrThrow({ where: { id: f.id }, include: { subscription: true } });
    expect(after.status).toBe("ACTIVE");
    expect(after.subscription?.status).toBe("ACTIVE");
    expect(Math.round((after.subscription!.currentPeriodEnd!.getTime() - Date.now()) / DAY)).toBeGreaterThanOrEqual(28);
    expect((await as(nurse).get("/api/facility/access")).body.locked).toBe(false);
    expect(await runAccessJob()).toEqual({ lapsed: 0, reminded: 0 });
  });

  it("recording a payment by hand opens a locked facility", async () => {
    const f = await makeFacility("Hand Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) } });
    await withPlan(f.id, { trialEndsAt: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() - 1000) });
    await runAccessJob();
    const inv = await prisma.invoice.findFirstOrThrow({ where: { facilityId: f.id } });
    const api = await platform();
    expect((await api.post(`/api/platform/invoices/${inv.id}/payment`, { method: "MOBILE_MONEY", reference: "MoMo 123" })).status).toBe(200);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("ACTIVE");
  });

  it("leaves a facility with no end date alone", async () => {
    await makeFacility("Open Clinic");
    expect(await runAccessJob()).toEqual({ lapsed: 0, reminded: 0 });
  });
});

describe("suspend, reinstate and extend", () => {
  it("reinstating a facility whose date has passed leaves it locked, and extending opens it", async () => {
    const f = await makeFacility("Held Clinic");
    await prisma.facility.update({ where: { id: f.id }, data: { status: "ACTIVE" } });
    await withPlan(f.id, { status: "ACTIVE", currentPeriodEnd: new Date(Date.now() - DAY) });
    const api = await platform();
    expect((await api.post(`/api/platform/facilities/${f.id}/suspend`, { reason: "Asked to pause" })).status).toBe(200);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: f.id } })).accessNote).toBe("Asked to pause");
    await api.post(`/api/platform/facilities/${f.id}/reactivate`, {});
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("LAPSED");
    const until = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    expect((await api.post(`/api/platform/facilities/${f.id}/extend`, { until, reason: "Paid by cheque" })).status).toBe(200);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("ACTIVE");
    const list = (await api.get("/api/platform/renewals")).body.renewals;
    expect(list[0]).toMatchObject({ name: "Held Clinic", status: "ACTIVE", endsOn: until });
  });
});

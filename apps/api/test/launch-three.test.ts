import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, as, freshIp, makeFacility, makeUser, prisma, resetDatabase, tokenFor } from "./helpers.js";
import { tick } from "../src/lib/scheduler.js";

beforeEach(resetDatabase);
afterEach(() => { vi.unstubAllGlobals(); delete process.env.PAYSTACK_SECRET_KEY; });

async function supportSetup(level: "READ_ONLY" | "FULL") {
  const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
  const facility = await makeFacility("Helped Clinic");
  const api = as(platform);
  const s = (await api.post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Roster will not generate for October", accessLevel: level })).body.session;
  const withSession = (method: "get" | "post", url: string, id = s.id as string) =>
    request(app)[method](url).set("Authorization", `Bearer ${tokenFor(platform)}`).set("X-Forwarded-For", freshIp()).set("x-support-session", id);
  return { platform, facility, session: s, withSession };
}

describe("support access inside a facility", () => {
  it("full access acts as the facility admin and writes to the facility's audit log", async () => {
    const { facility, withSession } = await supportSetup("FULL");
    const me = await withSession("get", "/api/facility");
    expect(me.status).toBe(200);
    expect(me.body.me.role).toBe("FACILITY_ADMIN");
    const made = await withSession("post", "/api/facility/departments").send({ name: "Maternity", code: "MAT" });
    expect(made.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    const logged = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "support_change" } });
    expect(logged?.summary).toMatch(/PS Tech support/);
  });

  it("read only can read and cannot change", async () => {
    const { withSession } = await supportSetup("READ_ONLY");
    expect((await withSession("get", "/api/facility")).status).toBe(200);
    const res = await withSession("post", "/api/facility/departments").send({ name: "Ward" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("support_read_only");
  });

  it("never reaches privacy exports, invitations or billing, and needs a live session of its own", async () => {
    const { withSession, platform } = await supportSetup("FULL");
    expect((await withSession("get", "/api/facility/privacy/export.json")).status).toBe(403);
    expect((await withSession("post", "/api/facility/billing/invoices/x/pay")).status).toBe(403);
    expect((await withSession("get", "/api/facility", "not-a-session")).status).toBe(403);
    // Without the header, a platform account still has no facility.
    expect((await as(platform).get("/api/facility")).status).toBe(403);
    // Someone else's session id does not work for another platform account.
    const { user: other } = await makeUser({ role: "PLATFORM_ADMIN" });
    const s = await prisma.supportSession.findFirstOrThrow();
    const res = await request(app).get("/api/facility").set("Authorization", `Bearer ${tokenFor(other)}`).set("X-Forwarded-For", freshIp()).set("x-support-session", s.id);
    expect(res.status).toBe(403);
  });

  it("stops when the session ends", async () => {
    const { withSession, platform, session } = await supportSetup("FULL");
    await as(platform).post(`/api/platform/support-sessions/${session.id}/end`);
    expect((await withSession("get", "/api/facility")).status).toBe(403);
  });
});

describe("online payment", () => {
  const sign = (body: string) => crypto.createHmac("sha512", "sk_test_x").update(body).digest("hex");

  async function owing() {
    const facility = await makeFacility("Paying Clinic");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const invoice = await prisma.invoice.create({ data: { facilityId: facility.id, invoiceNumber: "HF-202610-0001", status: "ISSUED", lineItems: [], subtotalGhs: 550, totalGhs: 550, dueAt: new Date(Date.now() + 864e5) } });
    return { facility, admin, invoice };
  }
  const paystackSays = (status: string, amount: number, channel = "mobile_money") =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: true, data: { status, amount, currency: "GHS", channel } }), { status: 200 })));

  it("rejects a webhook with a wrong signature", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const body = JSON.stringify({ event: "charge.success", data: { reference: "HF-x-1" } });
    const res = await request(app).post("/api/webhooks/paystack").set("Content-Type", "application/json").set("x-paystack-signature", "nope").send(body);
    expect(res.status).toBe(401);
  });

  it("marks the invoice paid only when Paystack confirms the amount", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const { invoice } = await owing();
    const ref = `HF-${invoice.id}-abc123`;
    const body = JSON.stringify({ event: "charge.success", data: { reference: ref } });
    const post = () => request(app).post("/api/webhooks/paystack").set("Content-Type", "application/json").set("x-paystack-signature", sign(body)).send(body);

    paystackSays("success", 10000); // wrong amount
    expect((await post()).status).toBe(200);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("ISSUED");

    paystackSays("success", 55000);
    expect((await post()).status).toBe(200);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentMethod: "MOBILE_MONEY", paymentReference: ref });
    expect((await post()).status).toBe(200); // a repeat does nothing
    expect(await prisma.auditLog.count({ where: { action: "payment_received" } })).toBe(1);
  });

  it("starts a payment for the facility's own invoice, and explains when it is not set up", async () => {
    const { admin, invoice } = await owing();
    const off = await as(admin).post(`/api/facility/billing/invoices/${invoice.id}/pay`);
    expect(off.status).toBe(503);
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }), { status: 200 })));
    const ok = await as(admin).post(`/api/facility/billing/invoices/${invoice.id}/pay`);
    expect(ok.body.url).toBe("https://checkout.paystack.com/abc");
    const other = await makeFacility("Other");
    const { user: stranger } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(stranger).post(`/api/facility/billing/invoices/${invoice.id}/pay`)).status).toBe(404);
  });
});

describe("scheduler", () => {
  it("runs each due job once and records it", async () => {
    const first = await tick();
    expect(first).toEqual(["support-expiry", "overdue-invoices", "access-and-reminders", "ward-transfers", "credential-reminders", "roster-deadlines", "whatsapp-reminders", "scorecard-snapshots", "handover-cleanup", "retention-scan", "sms-log-cleanup"]);
    expect(await tick()).toEqual([]);
    expect(await prisma.jobRun.count({ where: { ok: true } })).toBe(11);
  });

  it("shows job status to the console", async () => {
    await tick();
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    const res = await as(platform).get("/api/platform/health");
    expect(res.body.jobs).toHaveLength(11);
    expect(res.body.jobs.every((j: { late: boolean }) => !j.late)).toBe(true);
  });
});

describe("feature flags", () => {
  it("leave a capability on until a flag restricts it, then follow the flag", async () => {
    const facility = await makeFacility("Pilot");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    expect((await as(admin).get("/api/facility/directorate")).status).toBe(200);
    await as(platform).put("/api/platform/flags/district.oversight", { description: "Pilot", enabledGlobally: false, enabledForFacilityIds: [] });
    expect((await as(admin).get("/api/facility/directorate")).status).toBe(404);
    expect((await as(admin).get("/api/facility")).body.flags["district.oversight"]).toBe(false);
    await as(platform).put("/api/platform/flags/district.oversight", { description: "Pilot", enabledGlobally: false, enabledForFacilityIds: [facility.id] });
    expect((await as(admin).get("/api/facility/directorate")).status).toBe(200);
  });
});

describe("reports I sent", () => {
  it("shows the reporter the reply", async () => {
    const facility = await makeFacility("Reporter");
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    await as(user).post("/api/errors", { kind: "report", screen: "/roster", description: "The roster page shows a blank grid." });
    const report = await prisma.errorReport.findFirstOrThrow();
    await as(platform).post(`/api/platform/errors/${report.id}/reply`, { message: "Fixed, please refresh.", resolve: true });
    const mine = (await as(user).get("/api/errors/mine")).body.reports;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "RESOLVED", reply: "Fixed, please refresh." });
  });
});

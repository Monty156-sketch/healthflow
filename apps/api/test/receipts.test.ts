import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const f = await makeFacility("Receipt Clinic");
  const plan = await prisma.plan.create({ data: { name: "Health centre", monthlyPriceGhs: 250, sortOrder: 1 } });
  await prisma.subscription.create({ data: { facilityId: f.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) } });
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: "Ama Admin" } });
  const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
  return { f, admin, api: as(platform) };
}

describe("invoices and receipts a facility can ask for", () => {
  it("raises one invoice on request, returns the same open one next time, and gives a receipt only once paid", async () => {
    const { f, admin, api } = await setup();
    const a = await as(admin).post("/api/facility/billing/invoices", {});
    expect(a.status).toBe(201);
    expect((await as(admin).post("/api/facility/billing/invoices", {})).body.id).toBe(a.body.id);
    expect(await prisma.invoice.count({ where: { facilityId: f.id } })).toBe(1);
    expect((await as(admin).get(`/api/facility/billing/invoices/${a.body.id}/receipt`)).status).toBe(404);
    expect((await as(admin).get(`/api/facility/billing/invoices/${a.body.id}/pdf`)).status).toBe(200);
    expect((await api.post(`/api/platform/invoices/${a.body.id}/payment`, { method: "BANK_TRANSFER", reference: "GCB 4471" })).status).toBe(200);
    const r = await as(admin).get(`/api/facility/billing/invoices/${a.body.id}/receipt`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
  });

  it("lists every payment and who paid last for the console", async () => {
    const { f, admin, api } = await setup();
    const inv = (await as(admin).post("/api/facility/billing/invoices", {})).body;
    await api.post(`/api/platform/invoices/${inv.id}/payment`, { method: "MOBILE_MONEY", reference: "MoMo 9" });
    await makeFacility("Never Paid Clinic");
    const r = (await api.get("/api/platform/payments")).body;
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({ facility: "Receipt Clinic", totalGhs: 250, method: "MOBILE_MONEY" });
    expect(r.receivedGhs).toBe(250);
    expect(r.facilities.find((x: { id: string }) => x.id === f.id)).toMatchObject({ payments: 1, paidGhs: 250 });
    expect(r.facilities.find((x: { name: string }) => x.name === "Never Paid Clinic")).toMatchObject({ payments: 0, lastPaidAt: null });
    expect((await api.get("/api/platform/payments?month=2020-01")).body.payments).toHaveLength(0);
  });
});

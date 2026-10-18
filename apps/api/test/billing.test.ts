import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
  const facility = await makeFacility("Billed Clinic");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
  const api = as(platform);
  const plan = (await api.post("/api/platform/plans", { name: "Health Centre", monthlyPriceGhs: 500, setupPriceGhs: 1000 })).body.plan;
  await api.put(`/api/platform/facilities/${facility.id}/subscription`, { planId: plan.id, status: "ACTIVE" });
  const month = new Date().toISOString().slice(0, 7);
  return { api, facility, admin, plan, month };
}

describe("invoices", () => {
  it("previews, issues once for a month, and numbers each invoice", async () => {
    const { api, month } = await setup();
    const prev = (await api.get(`/api/platform/invoices/preview?month=${month}`)).body.items;
    expect(prev).toHaveLength(1);
    expect(prev[0].totalGhs).toBe(1500);
    expect((await api.post("/api/platform/invoices/generate", { month })).body.issued).toBe(1);
    expect((await api.post("/api/platform/invoices/generate", { month })).body.issued).toBe(0);
    const list = (await api.get("/api/platform/invoices")).body;
    expect(list.invoices[0].number).toMatch(/^HF-\d{6}-0001$/);
    expect(list.outstandingGhs).toBe(1500);
  });

  it("makes a PDF, and the facility can download only its own", async () => {
    const { api, admin, month } = await setup();
    await api.post("/api/platform/invoices/generate", { month });
    const id = (await api.get("/api/platform/invoices")).body.invoices[0].id;
    const pdf = await api.get(`/api/platform/invoices/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((await as(admin).get(`/api/facility/billing/invoices/${id}/pdf`)).status).toBe(200);
    const other = await makeFacility("Other");
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id });
    expect((await as(otherAdmin).get(`/api/facility/billing/invoices/${id}/pdf`)).status).toBe(404);
  });

  it("records a payment and closes the invoice, and flags a late one", async () => {
    const { api, month, facility } = await setup();
    await api.post("/api/platform/invoices/generate", { month });
    const inv = (await api.get("/api/platform/invoices")).body.invoices[0];
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(Date.now() - 86_400_000) } });
    const late = (await api.get("/api/platform/invoices")).body.invoices[0];
    expect(late.status).toBe("OVERDUE");
    expect((await prisma.subscription.findFirstOrThrow({ where: { facilityId: facility.id } })).status).toBe("PAST_DUE");
    expect((await api.post(`/api/platform/invoices/${inv.id}/payment`, { method: "BANK_TRANSFER", reference: "TT-1234" })).status).toBe(200);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect((await prisma.subscription.findFirstOrThrow({ where: { facilityId: facility.id } })).status).toBe("ACTIVE");
    expect((await api.post(`/api/platform/invoices/${inv.id}/payment`, { method: "CASH", reference: "again" })).status).toBe(409);
  });

  it("needs a reason to write off, and has no delete", async () => {
    const { api, month } = await setup();
    await api.post("/api/platform/invoices/generate", { month });
    const id = (await api.get("/api/platform/invoices")).body.invoices[0].id;
    expect((await api.post(`/api/platform/invoices/${id}/write-off`, { reason: "" })).status).toBe(400);
    expect((await api.post(`/api/platform/invoices/${id}/write-off`, { reason: "Facility closed" })).status).toBe(200);
    expect((await api.delete(`/api/platform/invoices/${id}`)).status).toBe(404);
  });
});

describe("suspension", () => {
  it("pauses editing but keeps reading and export", async () => {
    const { api, facility, admin } = await setup();
    expect((await api.post(`/api/platform/facilities/${facility.id}/suspend`, { reason: "Unpaid for 60 days" })).status).toBe(200);
    expect((await as(admin).get("/api/facility/staff")).status).toBe(200);
    expect((await as(admin).get("/api/facility/privacy/export.json")).status).toBe(200);
    const write = await as(admin).post("/api/facility/departments", { name: "New" });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("suspended");
    await api.post(`/api/platform/facilities/${facility.id}/reactivate`, {});
    expect((await as(admin).post("/api/facility/departments", { name: "New" })).status).toBeLessThan(300);
  });
});

describe("revenue", () => {
  it("adds up monthly recurring revenue from active subscriptions", async () => {
    const { api } = await setup();
    const r = (await api.get("/api/platform/revenue")).body;
    expect(r.mrrGhs).toBe(500);
    expect(r.activeSubscriptions).toBe(1);
  });
});

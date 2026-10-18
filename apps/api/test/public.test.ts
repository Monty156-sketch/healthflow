import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const good = { facilityName: "Sombo Health Centre", contactName: "Ama Dery", contactEmail: "Ama@Example.com", district: "Nadowli-Kaleo", region: "Upper West", staffCountEstimate: 24 };

describe("access requests", () => {
  it("writes a record, and creates no facility", async () => {
    const res = await request(app).post("/api/public/access-requests").send(good);
    expect(res.status).toBe(201);
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row).toMatchObject({ facilityName: "Sombo Health Centre", contactEmail: "ama@example.com", status: "NEW", source: "LANDING_PAGE", firstResponseAt: null });
    expect(await prisma.facility.count()).toBe(0);
  });

  it("asks for what is missing, and ignores a form filled in by a bot", async () => {
    const bad = await request(app).post("/api/public/access-requests").send({ ...good, contactEmail: "not-an-email", facilityName: "" });
    expect(bad.status).toBe(400);
    const bot = await request(app).post("/api/public/access-requests").send({ ...good, website: "http://spam.example" });
    expect(bot.status).toBe(400);
    expect(await prisma.accessRequest.count()).toBe(0);
  });

  it("lists only plans that have been entered and are active", async () => {
    expect((await request(app).get("/api/public/plans")).body.plans).toEqual([]);
    await prisma.plan.create({ data: { name: "Health centre", monthlyPriceGhs: 100, staffBandMin: 1, staffBandMax: 50, sortOrder: 1 } });
    await prisma.plan.create({ data: { name: "Retired", monthlyPriceGhs: 1, active: false } });
    const plans = (await request(app).get("/api/public/plans")).body.plans;
    expect(plans.map((p: { name: string }) => p.name)).toEqual(["Health centre"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("public plans", () => {
  it("lists only plans that have been entered and are active", async () => {
    expect((await request(app).get("/api/public/plans")).body.plans).toEqual([]);
    await prisma.plan.create({ data: { name: "Health centre", monthlyPriceGhs: 100, staffBandMin: 1, staffBandMax: 50, sortOrder: 1 } });
    await prisma.plan.create({ data: { name: "Retired", monthlyPriceGhs: 1, active: false } });
    const plans = (await request(app).get("/api/public/plans")).body.plans;
    expect(plans.map((p: { name: string }) => p.name)).toEqual(["Health centre"]);
  });
});

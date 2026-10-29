import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, freshIp, makeFacility, makeUser, prisma, resetDatabase, tokenFor } from "./helpers.js";

beforeEach(resetDatabase);

const DAY = 86_400_000;

async function world() {
  const facility = await makeFacility("Wa Clinic");
  const { user: staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Staff" } });
  const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
  return { facility, staff, platform };
}

describe("feedback prompt", () => {
  it("waits a week for a new account, then asks, then waits a month after feedback", async () => {
    const { staff } = await world();
    expect((await as(staff).get("/api/facility/feedback/prompt")).body.due).toBe(false);
    await prisma.userProfile.update({ where: { id: staff.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    expect((await as(staff).get("/api/facility/feedback/prompt")).body.due).toBe(true);

    const sent = await as(staff).post("/api/facility/feedback", { rating: 4, category: "GENERAL", message: "Rosters are much quicker now.", asked: true });
    expect(sent.status).toBe(201);
    expect((await as(staff).get("/api/facility/feedback/prompt")).body.due).toBe(false);
    const next = (await prisma.userProfile.findUniqueOrThrow({ where: { id: staff.id } })).feedbackNextAt!;
    expect(Math.round((next.getTime() - Date.now()) / DAY)).toBe(30);

    await prisma.userProfile.update({ where: { id: staff.id }, data: { feedbackNextAt: new Date(Date.now() - 1000) } });
    expect((await as(staff).get("/api/facility/feedback/prompt")).body.due).toBe(true);
    expect((await as(staff).post("/api/facility/feedback/later")).status).toBe(200);
    const later = (await prisma.userProfile.findUniqueOrThrow({ where: { id: staff.id } })).feedbackNextAt!;
    expect(Math.round((later.getTime() - Date.now()) / DAY)).toBe(7);
  });

  it("checks the rating and asks for words when the score is low or it is a problem", async () => {
    const { staff } = await world();
    expect((await as(staff).post("/api/facility/feedback", { rating: 6 })).status).toBe(400);
    expect((await as(staff).post("/api/facility/feedback", { rating: 0 })).status).toBe(400);
    const low = await as(staff).post("/api/facility/feedback", { rating: 2 });
    expect(low.status).toBe(400);
    expect(low.body.fields.message).toMatch(/little/i);
    expect((await as(staff).post("/api/facility/feedback", { rating: 5, category: "PROBLEM" })).status).toBe(400);
    expect((await as(staff).post("/api/facility/feedback", { rating: 5 })).status).toBe(201);
    expect(await prisma.feedback.count()).toBe(1);
  });
});

describe("feedback in the platform console", () => {
  it("shows every comment with the facility and role, filters, and lets PS Tech mark it", async () => {
    const { facility, staff, platform } = await world();
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Admin" }, mfa: true });
    await as(staff).post("/api/facility/feedback", { rating: 5, category: "PRAISE", message: "Swaps are easy now." });
    await as(admin).post("/api/facility/feedback", { rating: 2, category: "PROBLEM", message: "The roster page is slow on our phones." });

    const all = (await as(platform).get("/api/platform/feedback")).body;
    expect(all.summary).toMatchObject({ total: 2, average: 3.5, unread: 2 });
    expect(all.summary.byRating["5"]).toBe(1);
    expect(all.feedback).toHaveLength(2);
    expect(all.feedback[0]).toMatchObject({ facility: "Wa Clinic" });
    const low = (await as(platform).get("/api/platform/feedback?rating=2")).body.feedback;
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ role: "FACILITY_ADMIN", category: "PROBLEM" });

    expect((await as(platform).patch(`/api/platform/feedback/${low[0].id}`, { status: "ACTIONED", note: "Fixed in the next release" })).status).toBe(200);
    const after = (await as(platform).get("/api/platform/feedback?status=ACTIONED")).body.feedback;
    expect(after[0].note).toBe("Fixed in the next release");
    expect((await as(platform).get("/api/platform/feedback")).body.summary.unread).toBe(1);
  });

  it("is closed to facility users", async () => {
    const { staff } = await world();
    expect((await as(staff).get("/api/platform/feedback")).status).toBe(404);
  });

  it("is never asked of PS Tech support working inside a facility", async () => {
    const { facility, platform } = await world();
    const s = (await as(platform).post("/api/platform/support-sessions", { facilityId: facility.id, reason: "Looking at a roster problem", accessLevel: "FULL" })).body.session;
    const prompt = await request(app).get("/api/facility/feedback/prompt").set("Authorization", `Bearer ${tokenFor(platform)}`).set("X-Forwarded-For", freshIp()).set("x-support-session", s.id);
    expect(prompt.body.due).toBe(false);
    const post = await request(app).post("/api/facility/feedback").set("Authorization", `Bearer ${tokenFor(platform)}`).set("X-Forwarded-For", freshIp()).set("x-support-session", s.id).send({ rating: 5 });
    expect(post.status).toBe(403);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, freshIp, makeFacility, makeUser, PASSWORD, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const reg = {
  name: "Wa West", region: "Upper West", contactName: "Ama Dery", contactRole: "District Health Director",
  contactEmail: "Dho@Example.com", contactPhone: "0240000000", officeAddress: "District Health Directorate, Wa", password: "river stone morning light",
};
const register = (body: object = reg) => request(app).post("/api/public/districts/register").set("X-Forwarded-For", freshIp()).send(body);
const login = (email: string, audience?: string, password = PASSWORD) =>
  request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({ email, password, ...(audience ? { audience } : {}) });

describe("a district registers itself", () => {
  it("waits for approval: not in the directory, officer cannot sign in", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const d = await prisma.district.findFirstOrThrow();
    expect(d).toMatchObject({ name: "Wa West", status: "PENDING", active: false, contactEmail: "dho@example.com" });
    const officer = await prisma.userProfile.findFirstOrThrow({ where: { userEmail: "dho@example.com" } });
    expect(officer).toMatchObject({ role: "DISTRICT_OFFICER", scopeId: d.id, active: false });

    expect((await request(app).get("/api/public/districts")).body.districts).toEqual([]);
    const attempt = await login("dho@example.com", "district", reg.password);
    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toBe("district_pending");
  });

  it("goes into the directory and can sign in once approved", async () => {
    await register();
    const d = await prisma.district.findFirstOrThrow();
    const { user: admin } = await makeUser({ role: "PLATFORM_ADMIN" });
    expect((await as(admin).post(`/api/platform/districts/${d.id}/approve`)).status).toBe(200);
    expect((await request(app).get("/api/public/districts")).body.districts).toEqual([{ id: d.id, name: "Wa West", region: "Upper West" }]);
    const attempt = await login("dho@example.com", "district", reg.password);
    expect(attempt.body.error).not.toBe("district_pending");
    expect(attempt.body.error).not.toBe("wrong_door");
  });

  it("stays out of the directory when declined", async () => {
    await register();
    const d = await prisma.district.findFirstOrThrow();
    const { user: admin } = await makeUser({ role: "PLATFORM_ADMIN" });
    expect((await as(admin).post(`/api/platform/districts/${d.id}/decline`, { reason: "Not verified" })).status).toBe(200);
    expect((await request(app).get("/api/public/districts")).body.districts).toEqual([]);
    expect((await login("dho@example.com", "district", reg.password)).body.error).toBe("district_declined");
  });

  it("refuses a weak password, a repeat district and a taken email", async () => {
    expect((await register({ ...reg, password: "short" })).status).toBe(400);
    expect((await register()).status).toBe(201);
    expect((await register({ ...reg, contactEmail: "other@example.com" })).body.error).toBe("district_exists");
    expect((await register({ ...reg, name: "Wa East" })).body.error).toBe("email_taken");
    expect(await prisma.district.count()).toBe(1);
  });

  it("ignores a form filled in by a bot", async () => {
    expect((await register({ ...reg, website: "http://spam.example" })).status).toBe(400);
    expect(await prisma.district.count()).toBe(0);
  });
});

describe("each kind of account has its own sign-in", () => {
  it("sends a facility, district or platform account to its own page", async () => {
    const facility = await makeFacility();
    const { user: fa } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id });
    const { user: pa } = await makeUser({ role: "PLATFORM_ADMIN" });
    const wrong = await login(fa.userEmail, "platform");
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ error: "wrong_door", goTo: "/login" });
    expect((await login(pa.userEmail, "facility")).body).toMatchObject({ error: "wrong_door", goTo: "/platform/login" });
    expect((await login(pa.userEmail, "district")).body.goTo).toBe("/platform/login");
  });

  it("does not say anything about an account when the password is wrong", async () => {
    const { user: pa } = await makeUser({ role: "PLATFORM_ADMIN" });
    const res = await login(pa.userEmail, "facility", "not the password at all");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });
});

describe("a facility picks a registered district", () => {
  it("links the request, and the facility it becomes, to that district", async () => {
    const district = await prisma.district.create({ data: { name: "Nadowli-Kaleo", region: "Upper West" } });
    const res = await request(app).post("/api/public/access-requests").send({ facilityName: "Sombo Health Centre", contactName: "Ama Dery", contactEmail: "ama@example.com", districtId: district.id });
    expect(res.status).toBe(201);
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row).toMatchObject({ districtId: district.id, district: "Nadowli-Kaleo", region: "Upper West" });

    const { user: admin } = await makeUser({ role: "PLATFORM_ADMIN" });
    const made = await as(admin).post(`/api/platform/requests/${row.id}/provision`);
    expect(made.status).toBe(201);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: made.body.facilityId } })).districtId).toBe(district.id);
  });

  it("refuses a district that is not approved", async () => {
    const pending = await prisma.district.create({ data: { name: "Wa East", region: "Upper West", status: "PENDING", active: false } });
    const res = await request(app).post("/api/public/access-requests").send({ facilityName: "X Clinic", contactName: "Ama Dery", contactEmail: "ama@example.com", districtId: pending.id });
    expect(res.status).toBe(400);
    expect(await prisma.accessRequest.count()).toBe(0);
  });

  it("shows the district its facilities, with no staff data, and whether access was given", async () => {
    const district = await prisma.district.create({ data: { name: "Nadowli-Kaleo", region: "Upper West" } });
    const a = await prisma.facility.create({ data: { name: "Sombo HC", facilityType: "HEALTH_CENTRE", districtId: district.id } });
    await prisma.facility.create({ data: { name: "Elsewhere HC", facilityType: "HEALTH_CENTRE" } });
    await prisma.districtGrant.create({ data: { districtId: district.id, facilityId: a.id, scopes: ["COVERAGE"] } });
    const officer = await prisma.userProfile.create({ data: { userEmail: "dho2@example.test", passwordHash: "x", role: "DISTRICT_OFFICER", scopeType: "DISTRICT", scopeId: district.id } });
    const res = await as(officer).get("/api/district/facilities");
    expect(res.status).toBe(200);
    expect(res.body.facilities).toHaveLength(1);
    expect(res.body.facilities[0]).toMatchObject({ name: "Sombo HC", grantedAccess: true });
    const profile = await as(officer).get("/api/district/profile");
    expect(profile.body.district).toMatchObject({ name: "Nadowli-Kaleo", region: "Upper West" });
  });
});

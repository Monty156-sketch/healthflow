import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, freshIp, makeFacility, makeUser, PASSWORD, prisma, resetDatabase } from "./helpers.js";
import { grantedFor } from "../src/lib/district.js";

beforeEach(resetDatabase);

const pub = (url: string, body: object) => request(app).post(url).set("X-Forwarded-For", freshIp()).send(body);
const regionBody = (extra: object = {}) => ({ agency: "GHS", region: "Upper West", contactName: "Dr Amina Salifu", contactRole: "Regional Director", contactEmail: "region@ghs.test", password: PASSWORD, ...extra });
const districtBody = (extra: object = {}) => ({ name: "Wa West", region: "Upper West", agency: "GHS", contactName: "Kofi Boateng", contactEmail: "dho@ghs.test", password: PASSWORD, ...extra });

async function approvedRegion() {
  expect((await pub("/api/public/regions/register", regionBody())).status).toBe(201);
  const region = await prisma.district.findFirstOrThrow({ where: { level: "REGION" } });
  expect(region.status).toBe("PENDING");
  const { user: admin } = await makeUser({ role: "PLATFORM_ADMIN" });
  expect((await as(admin).post(`/api/platform/districts/${region.id}/approve`)).status).toBe(200);
  const officer = await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: "region@ghs.test" } });
  return { region, officer, admin };
}

describe("regional offices", () => {
  it("register, wait for PS Tech, then appear in the list districts choose from", async () => {
    expect((await request(app).get("/api/public/regions?agency=GHS").set("X-Forwarded-For", freshIp())).body.regions).toEqual([]);
    const { region } = await approvedRegion();
    const list = (await request(app).get("/api/public/regions?agency=GHS").set("X-Forwarded-For", freshIp())).body.regions;
    expect(list.map((r: { id: string }) => r.id)).toEqual([region.id]);
    expect((await request(app).get("/api/public/regions?agency=CHAG").set("X-Forwarded-For", freshIp())).body.regions).toEqual([]);
    // Not a district: a facility cannot pick it, and it is not in the district list.
    expect((await request(app).get("/api/public/districts").set("X-Forwarded-For", freshIp())).body.districts).toEqual([]);
    expect((await pub("/api/public/regions/register", regionBody({ contactEmail: "other@ghs.test" }))).status).toBe(409);
    expect((await pub("/api/public/regions/register", regionBody({ region: "Atlantis", contactEmail: "x@ghs.test" }))).status).toBe(400);
  });

  it("a district under a region waits for the region, and the region decides", async () => {
    const { region, officer } = await approvedRegion();
    const wrong = await pub("/api/public/districts/register", districtBody({ agency: "CHAG", regionOfficeId: region.id }));
    expect(wrong.status).toBe(400);
    expect((await pub("/api/public/districts/register", districtBody({ regionOfficeId: region.id }))).status).toBe(201);
    const d = await prisma.district.findFirstOrThrow({ where: { name: "Wa West" } });
    expect(d).toMatchObject({ status: "PENDING", regionOfficeId: region.id, level: "DISTRICT" });

    const asRegion = as({ ...officer, scopeType: "DISTRICT" } as never);
    const seen = (await asRegion.get("/api/region/districts")).body.districts;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: d.id, status: "PENDING" });
    expect((await asRegion.post(`/api/region/districts/${d.id}/approve`)).status).toBe(200);
    expect((await prisma.district.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("ACTIVE");
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: "dho@ghs.test" } })).active).toBe(true);
    expect((await asRegion.post(`/api/region/districts/${d.id}/approve`)).status).toBe(409);
  });

  it("a district officer cannot use the regional routes, and a region cannot touch another region's district", async () => {
    const { officer } = await approvedRegion();
    const lone = await prisma.district.create({ data: { name: "Lone", region: "Upper West" } });
    const dho = await makeUser({ role: "DISTRICT_OFFICER" });
    await prisma.userProfile.update({ where: { id: dho.user.id }, data: { scopeType: "DISTRICT", scopeId: lone.id } });
    expect((await as({ ...dho.user, scopeType: "DISTRICT", scopeId: lone.id } as never).get("/api/region/districts")).status).toBe(403);
    expect((await as({ ...officer, scopeType: "DISTRICT" } as never).post(`/api/region/districts/${lone.id}/approve`)).status).toBe(404);
  });

  it("a region reads only what the facilities of its approved districts have granted", async () => {
    const { region, officer } = await approvedRegion();
    const under = await prisma.district.create({ data: { name: "Wa West", region: "Upper West", regionOfficeId: region.id } });
    const elsewhere = await prisma.district.create({ data: { name: "Elsewhere", region: "Upper West" } });
    const shared = await makeFacility("Shared Clinic");
    const unshared = await makeFacility("Unshared Clinic");
    const outside = await makeFacility("Outside Clinic");
    await prisma.facility.update({ where: { id: shared.id }, data: { districtId: under.id } });
    await prisma.facility.update({ where: { id: unshared.id }, data: { districtId: under.id } });
    await prisma.facility.update({ where: { id: outside.id }, data: { districtId: elsewhere.id } });
    await prisma.districtGrant.create({ data: { districtId: under.id, facilityId: shared.id, scopes: ["COVERAGE"] } });
    await prisma.districtGrant.create({ data: { districtId: elsewhere.id, facilityId: outside.id, scopes: ["COVERAGE"] } });
    expect((await grantedFor(region.id, "COVERAGE")).map((g) => g.name)).toEqual(["Shared Clinic"]);
    const facilities = (await as({ ...officer, scopeType: "DISTRICT" } as never).get("/api/district/facilities")).body.facilities;
    expect(facilities.map((f: { name: string }) => f.name).sort()).toEqual(["Shared Clinic", "Unshared Clinic"]);
    expect(facilities.find((f: { name: string }) => f.name === "Shared Clinic").grantedAccess).toBe(true);
    expect(facilities.find((f: { name: string }) => f.name === "Unshared Clinic").grantedAccess).toBe(false);
  });
});

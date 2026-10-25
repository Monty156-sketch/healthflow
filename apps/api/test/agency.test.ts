import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, freshIp, makeFacility, PASSWORD, prisma, resetDatabase } from "./helpers.js";
import { grantedFor } from "../src/lib/district.js";

beforeEach(resetDatabase);

const pub = (url: string, body: object) => request(app).post(url).set("X-Forwarded-For", freshIp()).send(body);
const reg = (extra: object = {}) => ({
  facilityName: "St Mary Clinic", facilityType: "HEALTH_CENTRE", region: "Upper West", adminName: "Abena Mensah", adminEmail: "abena@stmary.test",
  adminPhone: "024 111 2233", password: PASSWORD, acceptedTerms: true, departments: ["Outpatient"], cadres: ["Nurse"], ...extra,
});

describe("Ghana Health Service and CHAG", () => {
  it("a facility's district must be under the same agency", async () => {
    const ghs = await prisma.district.create({ data: { name: "Wa", region: "Upper West", agency: "GHS" } });
    const chag = await prisma.district.create({ data: { name: "Wa CHAG", region: "Upper West", agency: "CHAG" } });
    const bad = await pub("/api/public/register-facility", reg({ agency: "CHAG", districtId: ghs.id }));
    expect(bad.status).toBe(400);
    expect(bad.body.fields.districtId).toMatch(/Ghana Health Service district/);
    const ok = await pub("/api/public/register-facility", reg({ agency: "CHAG", districtId: chag.id }));
    expect(ok.status).toBe(201);
    expect((await prisma.facility.findFirstOrThrow({ where: { name: "St Mary Clinic" } })).agency).toBe("CHAG");
  });

  it("lists only the districts of the agency asked for", async () => {
    await prisma.district.create({ data: { name: "Wa", region: "Upper West", agency: "GHS" } });
    await prisma.district.create({ data: { name: "Wa CHAG", region: "Upper West", agency: "CHAG" } });
    const names = async (q: string) => ((await request(app).get(`/api/public/districts${q}`).set("X-Forwarded-For", freshIp())).body.districts as { name: string }[]).map((d) => d.name);
    expect(await names("?agency=CHAG")).toEqual(["Wa CHAG"]);
    expect(await names("?agency=GHS")).toEqual(["Wa"]);
    expect((await names("")).sort()).toEqual(["Wa", "Wa CHAG"]);
  });

  it("a district registers under its agency, and never reads a facility of the other one", async () => {
    const r = await pub("/api/public/districts/register", { name: "Nadowli", region: "Upper West", agency: "CHAG", contactName: "Kofi Boateng", contactEmail: "kofi@chag.test", password: PASSWORD });
    expect(r.status).toBe(201);
    const d = await prisma.district.findFirstOrThrow({ where: { name: "Nadowli" } });
    expect(d.agency).toBe("CHAG");
    const ghsFacility = await makeFacility("GHS Clinic");
    const chagFacility = await prisma.facility.create({ data: { name: "CHAG Clinic", facilityType: "CLINIC", agency: "CHAG" } });
    for (const f of [ghsFacility, chagFacility]) {
      await prisma.districtGrant.create({ data: { districtId: d.id, facilityId: f.id, scopes: ["COVERAGE"] } });
    }
    expect((await grantedFor(d.id, "COVERAGE")).map((g) => g.name)).toEqual(["CHAG Clinic"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, freshIp, PASSWORD, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

const pub = (url: string, body: object) => request(app).post(url).set("X-Forwarded-For", freshIp()).send(body);
const reg = (extra: object = {}) => ({
  facilityName: "Wa Test Facility", facilityType: "HOSPITAL", region: "Upper West", adminName: "Abena Mensah", adminEmail: "abena@ward.test",
  adminPhone: "024 111 2233", password: PASSWORD, acceptedTerms: true, departments: [], cadres: [], ...extra,
});
const namesOf = async (facilityName: string) => {
  const f = await prisma.facility.findFirstOrThrow({ where: { name: facilityName } });
  return {
    departments: (await prisma.department.findMany({ where: { facilityId: f.id } })).map((d) => d.name),
    cadres: (await prisma.cadre.findMany({ where: { facilityId: f.id } })).map((c) => c.name),
  };
};

describe("wards for hospital types", () => {
  it("gives a hospital every ward and cadre without its administrator choosing any", async () => {
    expect((await pub("/api/public/register-facility", reg())).status).toBe(201);
    const { departments, cadres } = await namesOf("Wa Test Facility");
    for (const w of ["Male Medical Ward", "Female Medical Ward", "Male Surgical Ward", "Female Surgical Ward", "Labour Ward", "Outpatient", "Emergency", "Disease Control", "Mental Health"]) expect(departments).toContain(w);
    expect(departments).not.toContain("Oncology");
    expect(cadres).toContain("Public Health Nurse");
  });

  it("adds specialist units for regional and teaching hospitals, and a smaller set for a polyclinic", async () => {
    await pub("/api/public/register-facility", reg({ facilityName: "Regional", facilityType: "REGIONAL_HOSPITAL", adminEmail: "r@ward.test" }));
    await pub("/api/public/register-facility", reg({ facilityName: "Teaching", facilityType: "TEACHING_HOSPITAL", adminEmail: "t@ward.test" }));
    await pub("/api/public/register-facility", reg({ facilityName: "Poly", facilityType: "POLYCLINIC", adminEmail: "p@ward.test" }));
    expect((await namesOf("Regional")).departments).toContain("Oncology");
    expect((await namesOf("Teaching")).departments).toEqual(expect.arrayContaining(["Oncology", "Neurosurgery"]));
    const poly = (await namesOf("Poly")).departments;
    expect(poly).toContain("Male Medical Ward");
    expect(poly).not.toContain("Oncology");
  });

  it("offers the choice of departments only to the smaller facilities, and the public health units to them", async () => {
    const hospital = (await request(app).get("/api/public/register-facility/options?type=HOSPITAL")).body;
    const centre = (await request(app).get("/api/public/register-facility/options?type=HEALTH_CENTRE")).body;
    expect(hospital.auto).toBe(true);
    expect(centre.auto).toBe(false);
    expect(centre.publicHealthUnits).toHaveLength(12);
  });

  it("adds the public health units a health centre chose, and the cadres who work in them", async () => {
    const r = await pub("/api/public/register-facility", reg({ facilityName: "Centre", facilityType: "HEALTH_CENTRE", adminEmail: "c@ward.test", departments: ["Public Health"], cadres: ["Nurse"], publicHealthUnits: ["Disease Control", "Health Information", "Nutrition"] }));
    expect(r.status).toBe(201);
    const { departments, cadres } = await namesOf("Centre");
    expect(departments).toEqual(expect.arrayContaining(["Public Health", "Disease Control", "Health Information", "Nutrition"]));
    expect(cadres).toEqual(expect.arrayContaining(["Disease Control Officer", "Health Information Officer", "Nutrition Officer"]));
    expect(departments).not.toContain("Malaria Control");
  });

  it("still asks a health centre for at least one department and cadre", async () => {
    const r = await pub("/api/public/register-facility", reg({ facilityName: "Empty", facilityType: "HEALTH_CENTRE", adminEmail: "e@ward.test" }));
    expect(r.status).toBe(400);
  });
});

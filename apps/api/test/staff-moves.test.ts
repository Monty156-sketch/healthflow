import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function twoFacilities() {
  const a = await makeFacility("Sombo Health Centre");
  const b = await makeFacility("Nandom Municipal Hospital");
  const adminA = await makeUser({ role: "FACILITY_ADMIN", facilityId: a.id, withStaff: { fullName: "Admin A" } });
  const adminB = await makeUser({ role: "FACILITY_ADMIN", facilityId: b.id, withStaff: { fullName: "Admin B" } });
  const nurse = await makeUser({ role: "STAFF", facilityId: a.id, withStaff: { fullName: "Ama Nurse" } });
  await prisma.staff.update({ where: { id: nurse.staff!.id }, data: { phone: "0244000000", email: "ama@example.test", position: "Nurse", emergencyContactName: "Kofi" } });
  const cadre = await prisma.cadre.create({ data: { facilityId: a.id, name: "General Nurse" } });
  await prisma.staff.update({ where: { id: nurse.staff!.id }, data: { cadreId: cadre.id } });
  await prisma.cadre.create({ data: { facilityId: b.id, name: "general nurse" } });
  return { a, b, adminA, adminB, nurse, apiA: as(adminA.user), apiB: as(adminB.user) };
}

describe("deleting a member of staff", () => {
  it("removes the login and contact details but keeps the name for past rosters", async () => {
    const { apiA, nurse } = await twoFacilities();
    expect((await apiA.delete(`/api/facility/staff/${nurse.staff!.id}`, { reason: "x" })).status).toBe(400);
    expect((await apiA.delete(`/api/facility/staff/${nurse.staff!.id}`, { reason: "Added by mistake" })).status).toBe(200);
    expect(await prisma.userProfile.findUnique({ where: { id: nurse.user.id } })).toBeNull();
    const s = await prisma.staff.findUniqueOrThrow({ where: { id: nurse.staff!.id } });
    expect(s).toMatchObject({ fullName: "Ama Nurse", status: "INACTIVE", phone: null, email: null, emergencyContactName: null });
    expect(s.archivedAt).not.toBeNull();
  });

  it("will not delete yourself or another facility's staff", async () => {
    const { apiA, adminA, adminB } = await twoFacilities();
    expect((await apiA.delete(`/api/facility/staff/${adminA.staff!.id}`, { reason: "Testing it" })).status).toBe(409);
    expect((await apiA.delete(`/api/facility/staff/${adminB.staff!.id}`, { reason: "Testing it" })).status).toBe(404);
  });
});

describe("posting staff between facilities", () => {
  it("finds facilities only by a search of three letters or more", async () => {
    const { apiA } = await twoFacilities();
    expect((await apiA.get("/api/facility/staff-moves/destinations?q=na")).body.facilities).toEqual([]);
    const found = (await apiA.get("/api/facility/staff-moves/destinations?q=nandom")).body.facilities as { name: string }[];
    expect(found.map((f) => f.name)).toEqual(["Nandom Municipal Hospital"]);
    expect((await apiA.get("/api/facility/staff-moves/destinations?q=sombo")).body.facilities).toEqual([]);
  });

  it("moves the details and the login across only when the other facility accepts", async () => {
    const { b, apiA, apiB, nurse } = await twoFacilities();
    const ask = await apiA.post("/api/facility/staff-moves", { staffId: nurse.staff!.id, toFacilityId: b.id, note: "Posted by the director" });
    expect(ask.status).toBe(201);
    expect((await apiA.post("/api/facility/staff-moves", { staffId: nurse.staff!.id, toFacilityId: b.id })).status).toBe(409);
    expect((await apiA.post(`/api/facility/staff-moves/${ask.body.id}/accept`)).status).toBe(404); // the sender cannot accept for them
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { id: nurse.user.id } })).facilityId).not.toBe(b.id);

    const done = await apiB.post(`/api/facility/staff-moves/${ask.body.id}/accept`);
    expect(done.status).toBe(200);
    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { id: nurse.user.id }, include: { staff: true } });
    expect(profile).toMatchObject({ facilityId: b.id, scopeId: b.id, role: "STAFF" });
    expect(profile.staff).toMatchObject({ facilityId: b.id, fullName: "Ama Nurse", phone: "0244000000", status: "ACTIVE" });
    expect(profile.staff!.cadreId).not.toBeNull(); // matched "General Nurse" to the new facility's cadre by name
    const old = await prisma.staff.findUniqueOrThrow({ where: { id: nurse.staff!.id } });
    expect(old).toMatchObject({ status: "TRANSFERRED", phone: null, email: null, fullName: "Ama Nurse" });
    expect((await apiB.post(`/api/facility/staff-moves/${ask.body.id}/accept`)).status).toBe(409); // answered once only
  });

  it("lets the receiving facility decline and the sender withdraw", async () => {
    const { b, apiA, apiB, nurse } = await twoFacilities();
    const first = await apiA.post("/api/facility/staff-moves", { staffId: nurse.staff!.id, toFacilityId: b.id });
    expect((await apiB.post(`/api/facility/staff-moves/${first.body.id}/decline`)).status).toBe(200);
    const second = await apiA.post("/api/facility/staff-moves", { staffId: nurse.staff!.id, toFacilityId: b.id });
    expect((await apiA.post(`/api/facility/staff-moves/${second.body.id}/cancel`)).status).toBe(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: nurse.staff!.id } })).status).toBe("ACTIVE");
    expect((await apiB.get("/api/facility/staff-moves")).body.incoming).toHaveLength(2);
  });
});

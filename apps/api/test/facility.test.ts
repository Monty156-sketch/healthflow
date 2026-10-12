import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { issueRefreshToken } from "../src/lib/tokens.js";

beforeEach(resetDatabase);

async function adminOf(facilityName = "Sombo Health Centre") {
  const facility = await makeFacility(facilityName);
  const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  return { facility, admin: user, api: as(user) };
}

async function latestAudit(facilityId: string) {
  return prisma.auditLog.findFirst({ where: { facilityId }, orderBy: { createdAt: "desc" } });
}

describe("who can reach facility data", () => {
  it("refuses a platform admin: support sessions are the only way in (Part 3, 7.5)", async () => {
    await makeFacility();
    const { user } = await makeUser({ role: "PLATFORM_ADMIN" });
    const res = await as(user).get("/api/facility");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("no_facility_access");
  });

  it("lets a supervisor read staff but not change them", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(user).get("/api/facility/staff")).status).toBe(200);
    const create = await as(user).post("/api/facility/staff", { staffNo: "1", fullName: "A", employmentStatus: "PERMANENT" });
    expect(create.status).toBe(403);
  });

  it("refuses the staff role on admin screens", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    expect((await as(user).get("/api/facility/staff")).status).toBe(403);
  });

  it("keeps facilities apart: another facility's staff is simply not found", async () => {
    const a = await adminOf("Facility A");
    const b = await adminOf("Facility B");
    const created = await a.api.post("/api/facility/staff", { staffNo: "A1", fullName: "Ama Owusu", employmentStatus: "PERMANENT" });
    expect(created.status).toBe(201);
    const id = created.body.staff.id;
    expect((await b.api.get(`/api/facility/staff/${id}`)).status).toBe(404);
    expect((await b.api.patch(`/api/facility/staff/${id}/status`, { status: "RESIGNED" })).status).toBe(404);
    const list = await b.api.get("/api/facility/staff");
    expect(list.body.staff.map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("rejects a cadre that belongs to another facility", async () => {
    const a = await adminOf("Facility A");
    const b = await adminOf("Facility B");
    const cadre = await b.api.post("/api/facility/cadres", { name: "Midwife" });
    const res = await a.api.post("/api/facility/staff", {
      staffNo: "A2",
      fullName: "Yaw Mensah",
      employmentStatus: "PERMANENT",
      cadreId: cadre.body.cadre.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.cadreId).toBeTruthy();
  });
});

describe("departments and cadres", () => {
  it("adds, renames and refuses duplicates, writing sentences to the audit log", async () => {
    const { facility, api } = await adminOf();
    const created = await api.post("/api/facility/departments", { name: "Maternity", code: "MAT" });
    expect(created.status).toBe(201);
    expect((await latestAudit(facility.id))?.summary).toBe("Kofi Bawa added the Maternity department.");

    const dup = await api.post("/api/facility/departments", { name: "maternity" });
    expect(dup.status).toBe(409);
    expect(dup.body.fields.name).toMatch(/already exists/);

    const renamed = await api.patch(`/api/facility/departments/${created.body.department.id}`, { name: "Labour Ward", code: "MAT" });
    expect(renamed.status).toBe(200);
    expect((await latestAudit(facility.id))?.summary).toBe(
      "Kofi Bawa updated the Maternity department: renamed it from Maternity to Labour Ward."
    );
  });

  it("will not deactivate a department that still has current staff, and never deletes", async () => {
    const { api } = await adminOf();
    const dept = (await api.post("/api/facility/departments", { name: "OPD" })).body.department;
    const staff = (
      await api.post("/api/facility/staff", { staffNo: "S1", fullName: "Abena Dery", employmentStatus: "PERMANENT", departmentId: dept.id })
    ).body.staff;

    const blocked = await api.patch(`/api/facility/departments/${dept.id}/active`, { active: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 current staff member is in OPD/);

    await api.patch(`/api/facility/staff/${staff.id}/status`, { status: "TRANSFERRED" });
    const ok = await api.patch(`/api/facility/departments/${dept.id}/active`, { active: false });
    expect(ok.status).toBe(200);
    expect(ok.body.department.active).toBe(false);

    expect((await api.delete(`/api/facility/departments/${dept.id}`)).status).toBe(404);
    expect(await prisma.department.count({ where: { id: dept.id } })).toBe(1);
  });

  it("orders new cadres after existing ones", async () => {
    const { api } = await adminOf();
    await api.post("/api/facility/cadres", { name: "Nurse", code: "RGN" });
    await api.post("/api/facility/cadres", { name: "Midwife", code: "RM" });
    const list = await api.get("/api/facility/cadres");
    expect(list.body.cadres.map((c: { name: string }) => c.name)).toEqual(["Nurse", "Midwife"]);
  });
});

describe("staff records", () => {
  it("explains each invalid field in words", async () => {
    const { api } = await adminOf();
    const res = await api.post("/api/facility/staff", {
      staffNo: "",
      fullName: "",
      employmentStatus: "PERMANENT",
      phone: "12",
      email: "not-an-email",
      excludedFromNights: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.staffNo).toBe("Staff number is required.");
    expect(res.body.fields.fullName).toBe("Full name is required.");
    expect(res.body.fields.phone).toMatch(/phone number/);
    expect(res.body.fields.email).toMatch(/not a valid email/);
    expect(res.body.fields.exclusionReason).toMatch(/Never a medical reason/);
  });

  it("refuses a staff number already used in the facility", async () => {
    const { api } = await adminOf();
    await api.post("/api/facility/staff", { staffNo: "GHS-001", fullName: "Ama", employmentStatus: "PERMANENT" });
    const dup = await api.post("/api/facility/staff", { staffNo: "ghs-001", fullName: "Kwame", employmentStatus: "CONTRACT" });
    expect(dup.status).toBe(400);
    expect(dup.body.fields.staffNo).toMatch(/already has this staff number/);
  });

  it("stores dates as calendar dates and describes edits in a sentence", async () => {
    const { facility, api } = await adminOf();
    const cadre = (await api.post("/api/facility/cadres", { name: "Midwife" })).body.cadre;
    const created = await api.post("/api/facility/staff", {
      staffNo: "S9",
      fullName: "Abena Dery",
      employmentStatus: "CONTRACT",
      dateJoined: "2024-08-14",
    });
    expect(created.body.staff.dateJoined).toBe("2024-08-14");

    const updated = await api.patch(`/api/facility/staff/${created.body.staff.id}`, {
      staffNo: "S9",
      fullName: "Abena Dery",
      employmentStatus: "PERMANENT",
      dateJoined: "2024-08-14",
      cadreId: cadre.id,
      phone: "024 123 4567",
    });
    expect(updated.status).toBe(200);
    expect((await latestAudit(facility.id))?.summary).toBe(
      "Kofi Bawa updated Abena Dery's record: changed phone, employment type from Contract to Permanent and cadre from none to Midwife."
    );
  });

  it("lists current staff by default, former staff on request, and searches by name or number", async () => {
    const { api } = await adminOf();
    const a = (await api.post("/api/facility/staff", { staffNo: "100", fullName: "Ama Owusu", employmentStatus: "PERMANENT" })).body.staff;
    await api.post("/api/facility/staff", { staffNo: "200", fullName: "Kwame Asante", employmentStatus: "PERMANENT" });
    await api.patch(`/api/facility/staff/${a.id}/status`, { status: "RETIRED" });

    const current = await api.get("/api/facility/staff");
    expect(current.body.staff.map((s: { fullName: string }) => s.fullName)).toEqual(["Kofi Bawa", "Kwame Asante"]);
    const former = await api.get("/api/facility/staff?show=former");
    expect(former.body.staff.map((s: { fullName: string }) => s.fullName)).toEqual(["Ama Owusu"]);
    const byNumber = await api.get("/api/facility/staff?show=all&q=200");
    expect(byNumber.body.staff.map((s: { fullName: string }) => s.fullName)).toEqual(["Kwame Asante"]);
  });
});

describe("leaving ends access immediately (Part 3, 0.3 and 0.9)", () => {
  it("a transferred staff member is stopped on their very next request and cannot refresh", async () => {
    const { facility, api } = await adminOf();
    const { user: nurse, staff } = await makeUser({
      role: "ROSTER_MANAGER",
      facilityId: facility.id,
      withStaff: { fullName: "Akosua Frimpong" },
    });
    await issueRefreshToken({ userProfileId: nurse.id, facilityId: facility.id });
    const nurseApi = as(nurse); // holds a still-valid 15-minute access token

    expect((await nurseApi.get("/api/facility/staff")).status).toBe(200);

    const res = await api.patch(`/api/facility/staff/${staff!.id}/status`, { status: "TRANSFERRED" });
    expect(res.status).toBe(200);

    const after = await nurseApi.get("/api/facility/staff");
    expect(after.status).toBe(401);
    expect(after.body.error).toBe("session_ended");

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { id: nurse.id } });
    expect(profile.active).toBe(false);
    const liveSessions = await prisma.refreshToken.count({ where: { userProfileId: nurse.id, revokedAt: null } });
    expect(liveSessions).toBe(0);

    const audit = await latestAudit(facility.id);
    expect(audit?.summary).toMatch(
      /^Kofi Bawa changed Akosua Frimpong's status from Active to Transferred on \d{2}\/\d{2}\/\d{4}\. Their access was revoked and their sessions ended immediately\.$/
    );
  });

  it("setting them back to Active restores access", async () => {
    const { facility, api } = await adminOf();
    const { user, staff } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id, withStaff: { fullName: "Yaw Boateng" } });
    await api.patch(`/api/facility/staff/${staff!.id}/status`, { status: "INACTIVE" });
    expect((await as(user).get("/api/facility/staff")).status).toBe(401);
    await api.patch(`/api/facility/staff/${staff!.id}/status`, { status: "ACTIVE" });
    expect((await as(user).get("/api/facility/staff")).status).toBe(200);
  });

  it("an admin cannot end their own access", async () => {
    const { admin, api } = await adminOf();
    const res = await api.patch(`/api/facility/staff/${admin.staffId}/status`, { status: "RESIGNED" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_remove_self");
  });
});

describe("facility settings", () => {
  it("records changed settings in words", async () => {
    const { facility, api } = await adminOf();
    const current = (await api.get("/api/facility")).body.facility;
    const res = await api.patch("/api/facility", { ...current, weekStartsOn: 0, referencePeriodWeeks: 6 });
    expect(res.status).toBe(200);
    expect((await latestAudit(facility.id))?.summary).toBe(
      "Kofi Bawa changed the facility's week start from Monday to Sunday and reference period from 4 weeks to 6 weeks."
    );
  });
});

describe("audit log", () => {
  it("is readable by the facility admin, newest first, and cannot be edited or deleted", async () => {
    const { api } = await adminOf();
    await api.post("/api/facility/departments", { name: "OPD" });
    await api.post("/api/facility/departments", { name: "Maternity" });

    const res = await api.get("/api/facility/audit-log");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries[0].summary).toBe("Kofi Bawa added the Maternity department.");

    const id = res.body.entries[0].id;
    expect((await api.patch(`/api/facility/audit-log/${id}`, { summary: "x" })).status).toBe(404);
    expect((await api.delete(`/api/facility/audit-log/${id}`)).status).toBe(404);
  });

  it("is not readable by a supervisor", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(user).get("/api/facility/audit-log")).status).toBe(403);
  });
});

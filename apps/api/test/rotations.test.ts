import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const mk = (code: string, name: string, startTime: string, endTime: string, isOvernight: boolean) =>
    api.post("/api/facility/shifts", { name, code, startTime, endTime, isOvernight, minStaff: 2, minByCadre: {}, eligibleCadreIds: [], colour: "#25619f" });
  const m = (await mk("M", "Morning", "08:00", "14:00", false)).body.shift;
  const a = (await mk("A", "Afternoon", "14:00", "20:00", false)).body.shift;
  const n = (await mk("N", "Night", "20:00", "08:00", true)).body.shift;
  return { facility, admin, api, m, a, n };
}

describe("shift rotation", () => {
  it("starts with Night, Afternoon, Morning, in that order", async () => {
    const { api, m, a, n } = await setup();
    const { rotations } = (await api.get("/api/facility/rotations")).body;
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toMatchObject({ name: "Standard rotation", enforcement: "PREFER", active: true });
    expect(rotations[0].sequenceShiftIds).toEqual([n.id, a.id, m.id]);
    expect((await api.get("/api/facility/rotations")).body.rotations).toHaveLength(1);
  });

  it("keeps the order it is given, and checks the shifts are the facility's own", async () => {
    const { api, m, a, n } = await setup();
    await api.get("/api/facility/rotations");
    const body = { name: "Reverse", sequenceShiftIds: [m.id, a.id, n.id], applicableCadreIds: [], applicableDepartmentIds: [], enforcement: "PREFER" };
    const ok = await api.post("/api/facility/rotations", body);
    expect(ok.status).toBe(201);
    expect(ok.body.rotation.sequenceShiftIds).toEqual([m.id, a.id, n.id]);
    expect((await api.post("/api/facility/rotations", { ...body, sequenceShiftIds: [m.id] })).status).toBe(400);
    expect((await api.post("/api/facility/rotations", { ...body, sequenceShiftIds: [m.id, m.id] })).body.fields.sequenceShiftIds).toMatch(/once/);
    expect((await api.post("/api/facility/rotations", { ...body, sequenceShiftIds: [m.id, "nope"] })).body.fields.sequenceShiftIds).toMatch(/not a duty shift/);
    const edit = await api.patch(`/api/facility/rotations/${ok.body.rotation.id}`, { ...body, sequenceShiftIds: [n.id, m.id] });
    expect(edit.body.rotation.sequenceShiftIds).toEqual([n.id, m.id]);
  });

  it("needs a confirmation before it blocks, can be turned off, and a deleted one stays deleted", async () => {
    const { api, facility, m, a } = await setup();
    const first = (await api.get("/api/facility/rotations")).body.rotations[0];
    const body = { name: first.name, sequenceShiftIds: first.sequenceShiftIds, applicableCadreIds: [], applicableDepartmentIds: [], enforcement: "BLOCK" };
    const unconfirmed = await api.patch(`/api/facility/rotations/${first.id}`, body);
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("block_confirm_needed");
    expect((await api.patch(`/api/facility/rotations/${first.id}`, { ...body, confirmBlock: true })).body.rotation.enforcement).toBe("BLOCK");
    expect((await api.patch(`/api/facility/rotations/${first.id}/active`, { active: false })).body.rotation.active).toBe(false);

    const { user: supervisor } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id });
    expect((await as(supervisor).get("/api/facility/rotations")).status).toBe(200);
    expect((await as(supervisor).delete(`/api/facility/rotations/${first.id}`)).status).toBe(403);

    expect((await api.delete(`/api/facility/rotations/${first.id}`)).status).toBe(200);
    expect((await api.delete(`/api/facility/rotations/${first.id}`)).status).toBe(404);
    expect((await api.get("/api/facility/rotations")).body.rotations).toHaveLength(0);
    expect(m.id).not.toBe(a.id);
  });
});

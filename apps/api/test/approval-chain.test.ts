import { beforeEach, describe, expect, it } from "vitest";
import { as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Chain Hospital");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
  const { user: nm } = await makeUser({ role: "NURSING_MANAGER", facilityId: facility.id, withStaff: { fullName: "Naa Nursing" } });
  const { user: ms } = await makeUser({ role: "MEDICAL_SUPERINTENDENT", facilityId: facility.id, withStaff: { fullName: "Dr Mensah" } });
  const api = as(admin);
  const roster = (await api.post("/api/facility/rosters", { year: 2026, month: 12 })).body.roster;
  await prisma.roster.update({ where: { id: roster.id }, data: { status: "GENERATED" } });
  return { facility, api, nmApi: as(nm), msApi: as(ms), id: roster.id as string };
}

const move = (api: ReturnType<typeof as>, id: string, action: string, note?: string) => api.post(`/api/facility/rosters/${id}/status`, { action, ...(note ? { note } : {}) });

describe("approval chain", () => {
  it("cannot be switched on until a nursing manager and a medical superintendent exist", async () => {
    const facility = await makeFacility("Lonely Clinic");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Ama Admin" } });
    const res = await as(admin).put("/api/facility/approvals", { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("people_missing");
  });

  it("takes a roster from the in-charge to the nursing manager, the administrator and the medical superintendent", async () => {
    const { api, nmApi, msApi, id } = await setup();
    expect((await api.put("/api/facility/approvals", { enabled: true })).status).toBe(200);

    expect((await move(api, id, "submit")).body.roster.status).toBe("UNDER_REVIEW");
    // The old one-step approval is closed while the chain is on, and the administrator waits for the nursing manager.
    expect((await move(api, id, "approve")).status).toBe(409);
    expect((await move(api, id, "forward")).status).toBe(409);

    expect((await move(nmApi, id, "nm_approve")).body.roster.status).toBe("WITH_ADMINISTRATOR");
    expect((await move(api, id, "forward")).body.roster.status).toBe("WITH_SUPERINTENDENT");

    // Only the medical superintendent publishes.
    expect((await move(api, id, "publish")).status).toBe(403);
    const done = await move(msApi, id, "publish");
    expect(done.status).toBe(200);
    expect(done.body.roster.status).toBe("PUBLISHED");
  });

  it("returns a roster with a note the in-charge can read", async () => {
    const { api, nmApi, id } = await setup();
    await api.put("/api/facility/approvals", { enabled: true });
    await move(api, id, "submit");
    expect((await move(nmApi, id, "return")).status).toBe(400);
    const back = await move(nmApi, id, "return", "Night cover is thin on the 14th.");
    expect(back.body.roster).toMatchObject({ status: "GENERATED", returnNote: "Night cover is thin on the 14th.", returnedBy: "Naa Nursing" });
    // Sending it again clears the note.
    expect((await move(api, id, "submit")).body.roster.returnNote).toBeNull();
  });

  it("lets the nursing manager see everything and change nothing", async () => {
    const { api, nmApi, id } = await setup();
    expect((await nmApi.get("/api/facility/rosters")).status).toBe(200);
    expect((await nmApi.get(`/api/facility/rosters/${id}`)).status).toBe(200);
    expect((await nmApi.get("/api/facility/approvals/wards")).status).toBe(200);
    expect((await nmApi.post("/api/facility/rosters", { year: 2027, month: 1 })).status).toBe(403);
    expect((await nmApi.put("/api/facility/approvals", { enabled: true })).status).toBe(403);
    // Outside the chain the nursing manager has no step to take.
    await move(api, id, "submit");
    expect((await move(nmApi, id, "nm_approve")).status).toBe(409);
  });

  it("gives the medical superintendent every administrator right and shows their title", async () => {
    const { msApi } = await setup();
    const me = (await msApi.get("/api/facility")).body.me;
    expect(me).toMatchObject({ role: "FACILITY_ADMIN", position: "MEDICAL_SUPERINTENDENT" });
    expect((await msApi.get("/api/facility/access")).body.canPay).toBe(true);
  });

  it("keeps the old route when the chain is off", async () => {
    const { api, id } = await setup();
    await move(api, id, "submit");
    expect((await move(api, id, "approve")).body.roster.status).toBe("APPROVED");
    expect((await move(api, id, "publish")).body.roster.status).toBe("PUBLISHED");
  });
});

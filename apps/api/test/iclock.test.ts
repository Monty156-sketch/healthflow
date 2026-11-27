import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, makeFacility, makeUser, prisma, resetDatabase } from "./helpers.js";
import { parseAdmsAttlog } from "../src/lib/clockImport.js";

beforeEach(resetDatabase);

const SN = "QWC5234700869";
const post = (body: string, sn = SN, table = "ATTLOG") =>
  request(app).post(`/api/iclock/cdata?SN=${sn}&table=${table}&Stamp=9999`).set("Content-Type", "text/plain").send(body);

describe("the machine's own feed: reading punches", () => {
  it("reads the machine's lines: check-in, check-out, breaks ignored, a machine that does not say, and unreadable lines counted", () => {
    const r = parseAdmsAttlog([
      "7\t2026-11-16 07:50:12\t0\t15\t0\t0\t0",
      "7\t2026-11-16 14:05:00\t1\t15\t0",
      "7\t2026-11-16 10:00:00\t2\t15\t0",
      "8\t2026-11-16 08:10:00\t255\t1\t0",
      "AMHK-M060 2026-11-16 08:11:00 4 1",
      "not a punch",
      "9\t2026-13-45 99:99:99\t0",
      "",
    ].join("\r\n"));
    expect(r.skipped).toBe(2);
    expect(r.punches.map((p) => [p.pin, p.at.toISOString().slice(11, 16), p.state ?? null])).toEqual([
      ["7", "07:50", "IN"], ["7", "14:05", "OUT"], ["8", "08:10", null], ["AMHK-M060", "08:11", "IN"],
    ]);
  });
});

describe("the machine's own feed: the server side", () => {
  async function setup() {
    const facility = await makeFacility("Ahmadiyya Hospital");
    const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Administrator" } });
    await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Dery" } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, fullName: "Ama Dery" } });
    const a = as(admin);
    const dev = (await a.post("/api/facility/clock-devices", { name: "Main gate", brand: "ZKTeco", model: "MB460", serialNumber: SN })).body;
    await a.put("/api/facility/clock-devices/people", { numbers: [{ staffId: staff.id, clockNumber: "7" }] });
    const shift = (await a.post("/api/facility/shifts", { name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", isOvernight: false, minStaff: 1, colour: "#25619f" })).body.shift;
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
    const roster = await prisma.roster.create({ data: { facilityId: facility.id, month: day.getUTCMonth() + 1, year: day.getUTCFullYear(), status: "PUBLISHED" } });
    await prisma.rosterAssignment.create({ data: { rosterId: roster.id, facilityId: facility.id, staffId: staff.id, shiftId: shift.id, dutyDate: day } });
    return { facility, admin: a, dev, staff, d: day.toISOString().slice(0, 10) };
  }

  it("does not know a machine that was never registered, whatever it says", async () => {
    await setup();
    expect((await request(app).get("/api/iclock/cdata?SN=ZZZ99999999&options=all")).status).toBe(404);
    expect((await request(app).get("/api/iclock/cdata?options=all")).status).toBe(404);
    expect((await post("7\t2026-11-16 07:50:00\t0\t1", "ZZZ99999999")).status).toBe(404);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("greets a registered machine, asks only for punches, and notes when it last connected", async () => {
    const { dev } = await setup();
    const r = await request(app).get(`/api/iclock/cdata?SN=${SN.toLowerCase()}&options=all&pushver=2.4.1`);
    expect(r.status).toBe(200);
    expect(r.text).toContain("GET OPTION FROM: ");
    expect(r.text).toContain("TransFlag=TransData AttLog\n");
    expect(r.text).not.toMatch(/FP|UserPic|AttPhoto|EnrollUser/);
    expect(r.text).toContain("Realtime=1");
    expect((await prisma.clockDevice.findUniqueOrThrow({ where: { id: dev.id } })).lastSeenAt).not.toBeNull();
    expect((await request(app).get(`/api/iclock/getrequest?SN=${SN}&INFO=x`)).text).toBe("OK");
  });

  it("records the arrival at once, then adds the departure when the check-out arrives alone, and never twice", async () => {
    const { d } = await setup();
    const first = await post(`7\t${d} 07:50:00\t0\t15\t0`);
    expect(first.status).toBe(200);
    expect(first.text).toBe("OK:1");
    const a = await prisma.attendance.findFirstOrThrow();
    expect(a).toMatchObject({ status: "PRESENT", minutesEarly: 10, source: "DEVICE" });
    expect(a.note).toContain("No check-out");

    expect((await post(`7\t${d} 14:05:00\t1\t15\t0`)).text).toBe("OK:1");
    expect(await prisma.attendance.count()).toBe(1);
    expect((await prisma.attendance.findFirstOrThrow()).note).toContain("Left at 14:05");

    // the machine sends the same lines again (a lost reply): nothing new
    await post(`7\t${d} 07:50:00\t0\t15\t0\n7\t${d} 14:05:00\t1\t15\t0`);
    expect(await prisma.attendance.count()).toBe(1);
    expect(await prisma.devicePunch.count()).toBe(2);
  });

  it("takes other tables politely, leaves unknown numbers and very old punches out, and says how many lines it took", async () => {
    await setup();
    expect((await post("anything", SN, "OPERLOG")).text).toBe("OK");
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const r = await post(`7\t${old} 07:50:00\t0\n99\t${new Date().toISOString().slice(0, 10)} 08:00:00\t0`);
    expect(r.text).toBe("OK:2");
    expect(await prisma.attendance.count()).toBe(0);
    expect(await prisma.devicePunch.count()).toBe(0);
  });

  it("stops trusting a machine that is turned off, and a serial number cannot be registered twice", async () => {
    const { dev, admin } = await setup();
    await admin.put(`/api/facility/clock-devices/${dev.id}`, { name: "Main gate", serialNumber: SN, active: false });
    expect((await request(app).get(`/api/iclock/cdata?SN=${SN}`)).status).toBe(404);
    await admin.put(`/api/facility/clock-devices/${dev.id}`, { name: "Main gate", serialNumber: SN, active: true });

    const other = await makeFacility("Another Hospital");
    const { user: otherAdmin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: other.id, withStaff: { fullName: "Other Admin" } });
    const clash = await as(otherAdmin).post("/api/facility/clock-devices", { name: "Gate", serialNumber: SN.toLowerCase() });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe("serial_taken");
    expect((await admin.post("/api/facility/clock-devices", { name: "Second", serialNumber: SN })).status).toBe(409);
  });
});

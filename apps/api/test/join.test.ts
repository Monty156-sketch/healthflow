import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, as, freshIp, makeFacility, makeUser, prisma, resetDatabase, PASSWORD } from "./helpers.js";

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMS_API_KEY;
  delete process.env.SMS_SENDER_ID;
});

const pub = {
  get: (u: string) => request(app).get(u).set("X-Forwarded-For", freshIp()),
  post: (u: string, b: object) => request(app).post(u).set("X-Forwarded-For", freshIp()).send(b),
};

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  await prisma.privacyNotice.create({ data: { facilityId: facility.id, version: "1", body: "Notice", publishedAt: new Date() } });
  const admin = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "In Charge" } });
  const api = as(admin.user);
  const code = (await api.get("/api/facility/join/code")).body.code as string;
  return { facility, api, code };
}

const details = (code: string, extra: object = {}) => ({ code, fullName: "Ama Dery", staffNo: "S-100", phone: "024 618 7422", ...extra });

describe("staff joining with the facility access code", () => {
  it("makes a readable code that is the same on the next visit", async () => {
    const { api, code } = await setup();
    expect(code).toMatch(/^HF-[2-9A-HJKMNP-Z]{6}$/);
    expect((await api.get("/api/facility/join/code")).body.code).toBe(code);
    expect((await pub.get(`/api/public/join/${code.toLowerCase()}`)).body.facilityName).toBe("Sombo Health Centre");
    expect((await pub.get("/api/public/join/HF-NOPE00")).status).toBe(404);
  });

  it("without a text service, registers a pending account that cannot sign in and waits for approval", async () => {
    const { api, facility, code } = await setup();
    const start = await pub.post("/api/public/join", details(code));
    expect(start.status).toBe(201);
    expect(start.body.verifyMethod).toBe("NONE");
    const done = await pub.post("/api/public/join/complete", { token: start.body.token, password: PASSWORD, acceptedNoticeVersion: "1" });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe("pending");

    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S-100" } });
    expect(staff).toMatchObject({ status: "PENDING", joinedVia: "CODE", phoneVerified: false });
    const login = await pub.post("/api/auth/login", { email: "0246187422", password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe("account_pending");

    const list = await api.get("/api/facility/join/pending");
    expect(list.body.pending).toHaveLength(1);
    expect((await api.post("/api/facility/join/approve", { staffIds: [staff.id] })).body.approved).toBe(1);
    const ok = await pub.post("/api/auth/login", { email: "0246187422", password: PASSWORD });
    expect(ok.status).toBe(200);
  });

  it("checks the phone by text, locks after three wrong codes, and can skip approval when the facility allows it", async () => {
    process.env.SMS_API_KEY = "k";
    process.env.SMS_SENDER_ID = "HealthFlow";
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init: { body: string }) => { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ status: "success" }), { status: 200 }); }));
    const { api, facility, code } = await setup();
    await api.put("/api/facility/join/code", { requiresApproval: false, active: true });

    const start = await pub.post("/api/public/join", details(code));
    expect(start.body.verifyMethod).toBe("SMS");
    const real = /code is (\d{6})/.exec(sent[0])![1];
    const token = start.body.token;
    expect((await pub.post("/api/public/join/complete", { token, password: PASSWORD, acceptedNoticeVersion: "1" })).body.error).toBe("not_verified");
    const wrong = real === "111111" ? "222222" : "111111";
    expect((await pub.post("/api/public/join/verify", { token, code: wrong })).body.error).toBe("wrong_code");
    expect((await pub.post("/api/public/join/verify", { token, code: wrong })).body.error).toBe("wrong_code");
    expect((await pub.post("/api/public/join/verify", { token, code: wrong })).status).toBe(423);
    expect((await pub.post("/api/public/join/verify", { token, code: real })).status).toBe(423);

    const again = await pub.post("/api/public/join", details(code, { staffNo: "S-101", phone: "0555555555" }));
    const realB = /code is (\d{6})/.exec(sent[1])![1];
    expect((await pub.post("/api/public/join/verify", { token: again.body.token, code: realB })).body.verified).toBe(true);
    const done = await pub.post("/api/public/join/complete", { token: again.body.token, password: PASSWORD, acceptedNoticeVersion: "1" });
    expect(done.body.status).toBe("active");
    expect((await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S-101" } })).phoneVerified).toBe(true);
  });

  it("refuses a taken staff number, a revoked code, and respects the use limit", async () => {
    const { api, facility, code } = await setup();
    await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "S-100", fullName: "Someone", status: "ACTIVE" } });
    expect((await pub.post("/api/public/join", details(code))).body.error).toBe("staff_number_taken");

    await prisma.facilityAccessCode.updateMany({ where: { facilityId: facility.id }, data: { maxUses: 1 } });
    const a = await pub.post("/api/public/join", details(code, { staffNo: "S-200", phone: "0201111111" }));
    const b = await pub.post("/api/public/join", details(code, { staffNo: "S-201", phone: "0202222222" }));
    expect((await pub.post("/api/public/join/complete", { token: a.body.token, password: PASSWORD, acceptedNoticeVersion: "1" })).status).toBe(201);
    expect((await pub.post("/api/public/join/complete", { token: b.body.token, password: PASSWORD, acceptedNoticeVersion: "1" })).status).toBe(404);

    const fresh = (await api.post("/api/facility/join/code/regenerate", {})).body.code;
    expect(fresh).not.toBe(code);
    expect((await pub.get(`/api/public/join/${code}`)).status).toBe(404);
  });

  it("lets an administrator reject with a reason, and only administrators use the screens", async () => {
    const { api, facility, code } = await setup();
    const start = await pub.post("/api/public/join", details(code));
    await pub.post("/api/public/join/complete", { token: start.body.token, password: PASSWORD, acceptedNoticeVersion: "1" });
    const staff = await prisma.staff.findFirstOrThrow({ where: { facilityId: facility.id, staffNo: "S-100" } });
    expect((await api.post("/api/facility/join/reject", { staffIds: [staff.id], reason: "" })).status).toBe(400);
    expect((await api.post("/api/facility/join/reject", { staffIds: [staff.id], reason: "Not on our staff." })).body.rejected).toBe(1);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe("INACTIVE");
    const nurse = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Nurse" } });
    expect((await as(nurse.user).get("/api/facility/join/code")).status).toBe(403);
  });
});

describe("staff choosing not to get texts", () => {
  it("lets a person switch texts off for themselves", async () => {
    const facility = await makeFacility();
    const nurse = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Nurse" } });
    const api = as(nurse.user);
    expect((await api.get("/api/facility/me/sms-opt-out")).body.optOut).toBe(false);
    expect((await api.put("/api/facility/me/sms-opt-out", { optOut: true })).body.optOut).toBe(true);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: nurse.staff!.id } })).smsOptOut).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "sms_opt_out_changed" } })).toBe(1);
  });
});

describe("a facility registering itself", () => {
  const body = (extra: object = {}) => ({
    facilityName: "Kaleo Health Centre", facilityType: "HEALTH_CENTRE", region: "Upper West", adminName: "Abena Mensah", adminEmail: "abena@kaleo.test",
    adminPhone: "024 111 2233", password: PASSWORD, acceptedTerms: true, ...extra,
  });

  it("creates the facility, its administrator and an HF- access code that staff can use straight away", async () => {
    const res = await pub.post("/api/public/register-facility", body());
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^HF-[2-9A-HJKMNP-Z]{6}$/);
    const facility = await prisma.facility.findFirstOrThrow({ where: { name: "Kaleo Health Centre" } });
    expect(facility.status).toBe("TRIAL");
    expect(await prisma.department.count({ where: { facilityId: facility.id } })).toBeGreaterThan(5);
    expect(await prisma.privacyNotice.count({ where: { facilityId: facility.id, publishedAt: { not: null } } })).toBe(1);
    const admin = await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: "abena@kaleo.test" } });
    expect(admin).toMatchObject({ role: "FACILITY_ADMIN", active: true, facilityId: facility.id });

    expect((await pub.get(`/api/public/join/${res.body.code}`)).body.facilityName).toBe("Kaleo Health Centre");
    const login = await pub.post("/api/auth/login", { email: "abena@kaleo.test", password: PASSWORD, audience: "facility" });
    expect(login.status).toBe(200); // the administrator is asked to set up two-step sign-in next
  });

  it("turns away a taken email, a repeated facility, a weak password, and missing consent", async () => {
    expect((await pub.post("/api/public/register-facility", body())).status).toBe(201);
    expect((await pub.post("/api/public/register-facility", body({ facilityName: "Other Clinic" }))).body.error).toBe("email_taken");
    expect((await pub.post("/api/public/register-facility", body({ adminEmail: "x@kaleo.test" }))).body.error).toBe("facility_exists");
    expect((await pub.post("/api/public/register-facility", body({ facilityName: "Third", adminEmail: "y@kaleo.test", password: "short" }))).body.fields.password).toBeTruthy();
    expect((await pub.post("/api/public/register-facility", body({ facilityName: "Fourth", adminEmail: "z@kaleo.test", acceptedTerms: false }))).status).toBe(400);
  });
});

describe("the text gateway check", () => {
  it("sends a real test text through the phone gateway and records it, three an hour at most", async () => {
    process.env.SMS_PROVIDER = "sms-gate";
    process.env.SMS_GATE_USER = "u";
    process.env.SMS_GATE_PASSWORD = "p";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const facility = await makeFacility();
      const admin = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "In Charge" } });
      const api = as(admin.user);
      const ok = await api.post("/api/facility/sms/test", { phone: "024 618 7422" });
      expect(ok.status).toBe(200);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/message");
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
      expect(JSON.parse(init.body).phoneNumbers).toEqual(["+233246187422"]);
      await api.post("/api/facility/sms/test", { phone: "0246187422" });
      await api.post("/api/facility/sms/test", { phone: "0246187422" });
      expect((await api.post("/api/facility/sms/test", { phone: "0246187422" })).status).toBe(429);
      expect(await prisma.smsMessage.count({ where: { facilityId: facility.id, type: "test", status: "SENT" } })).toBe(3);
    } finally {
      delete process.env.SMS_PROVIDER;
      delete process.env.SMS_GATE_USER;
      delete process.env.SMS_GATE_PASSWORD;
    }
  });
});

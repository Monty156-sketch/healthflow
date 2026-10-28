import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  app,
  as,
  cookieFrom,
  freshIp,
  makeFacility,
  makeUser,
  PASSWORD,
  prisma,
  resetDatabase,
  signIn,
  totp,
  withToken,
} from "./helpers.js";
import { makeResetToken } from "../src/lib/signedTokens.js";

beforeEach(resetDatabase);

const NEW_PASSWORD = "maternity ward night roster";

function post(url: string, body: object, cookie?: string) {
  const r = request(app).post(url).set("X-Forwarded-For", freshIp());
  if (cookie) r.set("Cookie", cookie);
  return r.send(body);
}

async function latestAudit(facilityId: string | null) {
  return prisma.auditLog.findFirst({ where: { facilityId }, orderBy: { createdAt: "desc" } });
}

describe("two-step sign-in set up during sign-in", () => {
  it("an admin without it is walked through setup and then signed in", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });

    const login = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe("mfa_setup_required");
    const { enrolmentToken } = login.body;

    // The enrolment pass is good for setup and nothing else.
    expect((await withToken(enrolmentToken).get("/api/auth/account")).status).toBe(401);

    const start = await post("/api/auth/mfa/enrol/start", { enrolmentToken });
    expect(start.status).toBe(200);
    expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const wrong = await post("/api/auth/mfa/enrol/finish", { enrolmentToken, setupToken: start.body.setupToken, totp: "000000" });
    expect(wrong.status).toBe(401);

    const finish = await post("/api/auth/mfa/enrol/finish", {
      enrolmentToken,
      setupToken: start.body.setupToken,
      totp: totp(start.body.secret),
    });
    expect(finish.status).toBe(200);
    expect(finish.body.recoveryCodes).toHaveLength(10);
    expect(finish.body.accessToken).toBeTruthy();
    cookieFrom(finish); // a session cookie was set

    const after = await prisma.userProfile.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mfaEnabled).toBe(true);
    expect((await latestAudit(facility.id))?.summary).toMatch(/^Kofi Bawa signed in for the first time with two-step sign-in/);
  });

  it("a setup token cannot be used for someone else", async () => {
    const facility = await makeFacility();
    const a = (await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id })).user;
    const b = (await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id })).user;
    const tokA = (await post("/api/auth/login", { email: a.userEmail, password: PASSWORD })).body.enrolmentToken;
    const tokB = (await post("/api/auth/login", { email: b.userEmail, password: PASSWORD })).body.enrolmentToken;
    const startA = await post("/api/auth/mfa/enrol/start", { enrolmentToken: tokA });
    const res = await post("/api/auth/mfa/enrol/finish", { enrolmentToken: tokB, setupToken: startA.body.setupToken, totp: totp(startA.body.secret) });
    expect(res.status).toBe(401);
  });
});

describe("sign-in hardening", () => {
  it("wrong authentication codes count towards the lockout", async () => {
    const facility = await makeFacility();
    const { user, mfaSecret } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, mfa: true });
    for (let i = 0; i < 5; i++) {
      const r = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, totp: "000000" });
      expect(r.status).toBe(401);
    }
    const locked = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, totp: totp(mfaSecret) });
    expect(locked.status).toBe(423);
  });

  it("matches email addresses regardless of capital letters", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const r = await post("/api/auth/login", { email: user.userEmail.toUpperCase(), password: PASSWORD });
    expect(r.status).toBe(200);
  });
});

describe("sessions", () => {
  it("lists live sessions, marks this device, and signs out the others", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const phone = await signIn(user.userEmail, PASSWORD, {}, "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const laptop = await signIn(user.userEmail, PASSWORD, {}, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0");

    const list = await withToken(laptop.accessToken, laptop.cookie).get("/api/auth/sessions");
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    const current = list.body.sessions.find((s: { current: boolean }) => s.current);
    expect(current.device).toBe("Chrome on Windows");
    expect(list.body.sessions.map((s: { device: string }) => s.device)).toContain("Chrome on Android");

    const out = await withToken(laptop.accessToken, laptop.cookie).post("/api/auth/sessions/revoke-others");
    expect(out.body.signedOut).toBe(1);
    expect((await post("/api/auth/refresh", {}, phone.cookie)).status).toBe(401);
    expect((await post("/api/auth/refresh", {}, laptop.cookie)).status).toBe(200);
  });

  it("cannot sign out someone else's session", async () => {
    const facility = await makeFacility();
    const a = (await makeUser({ role: "STAFF", facilityId: facility.id })).user;
    const b = (await makeUser({ role: "STAFF", facilityId: facility.id })).user;
    await signIn(b.userEmail, PASSWORD);
    const bSession = await prisma.refreshToken.findFirstOrThrow({ where: { userProfileId: b.id } });
    expect((await as(a).post(`/api/auth/sessions/${bSession.id}/revoke`)).status).toBe(404);
  });
});

describe("changing a password", () => {
  it("needs the current password, refuses weak ones, and signs out other devices", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Owusu" } });
    const other = await signIn(user.userEmail, PASSWORD);
    const here = await signIn(user.userEmail, PASSWORD);
    const api = withToken(here.accessToken, here.cookie);

    const wrong = await api.post("/api/auth/account/password", { currentPassword: "nope", newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields.currentPassword).toBe("That is not your current password.");

    const weak = await api.post("/api/auth/account/password", { currentPassword: PASSWORD, newPassword: "Password1234!" });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.newPassword).toMatch(/too common/);

    const short = await api.post("/api/auth/account/password", { currentPassword: PASSWORD, newPassword: "short" });
    expect(short.body.fields.newPassword).toMatch(/at least 12 characters/);

    const ok = await api.post("/api/auth/account/password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.otherDevicesSignedOut).toBe(1);
    expect((await post("/api/auth/refresh", {}, other.cookie)).status).toBe(401);
    expect((await post("/api/auth/refresh", {}, here.cookie)).status).toBe(200);
    expect((await post("/api/auth/login", { email: user.userEmail, password: NEW_PASSWORD })).status).toBe(200);
    expect((await latestAudit(facility.id))?.summary).not.toBeUndefined();
  });
});

describe("managing two-step sign-in", () => {
  it("starting a replacement and walking away leaves the old authenticator working", async () => {
    const facility = await makeFacility();
    const { user, mfaSecret } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, mfa: true });
    const start = await as(user).post("/api/auth/account/mfa/start", { currentPassword: PASSWORD });
    expect(start.status).toBe(200);
    // ...abandoned. The old authenticator still signs in:
    const login = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, totp: totp(mfaSecret) });
    expect(login.status).toBe(200);
  });

  it("replacing it switches to the new authenticator and new recovery codes", async () => {
    const facility = await makeFacility();
    const { user, mfaSecret } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, mfa: true });
    expect((await as(user).post("/api/auth/account/mfa/start", { currentPassword: "wrong" })).status).toBe(400);

    const start = await as(user).post("/api/auth/account/mfa/start", { currentPassword: PASSWORD });
    const finish = await as(user).post("/api/auth/account/mfa/finish", { setupToken: start.body.setupToken, totp: totp(start.body.secret) });
    expect(finish.status).toBe(200);
    expect(finish.body.recoveryCodes).toHaveLength(10);

    const oldCode = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, totp: totp(mfaSecret) });
    // The two secrets could produce the same 6 digits by chance only 1 in a million times.
    expect(oldCode.status).toBe(401);
    const newCode = await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, totp: totp(start.body.secret) });
    expect(newCode.status).toBe(200);
  });

  it("recovery codes sign in once each, and can be replaced", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "SUPERVISOR", facilityId: facility.id, mfa: true });
    const fresh = await as(user).post("/api/auth/account/mfa/recovery-codes", { currentPassword: PASSWORD });
    expect(fresh.status).toBe(200);
    const code = fresh.body.recoveryCodes[0] as string;

    expect((await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, recoveryCode: code.toLowerCase() })).status).toBe(200);
    expect((await post("/api/auth/login", { email: user.userEmail, password: PASSWORD, recoveryCode: code })).status).toBe(401);
    const summary = await as(user).get("/api/auth/account");
    expect(summary.body.account.recoveryCodesLeft).toBe(9);
  });

  it("admins, in-charges and supervisors can never turn it off; other staff can", async () => {
    const facility = await makeFacility();
    for (const role of ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"] as const) {
      const user = (await makeUser({ role, facilityId: facility.id, mfa: true })).user;
      expect((await as(user).post("/api/auth/account/mfa/disable", { currentPassword: PASSWORD })).status).toBe(403);
    }
    const nurse = (await makeUser({ role: "STAFF", facilityId: facility.id, mfa: true })).user;
    expect((await as(nurse).post("/api/auth/account/mfa/disable", { currentPassword: PASSWORD })).status).toBe(200);
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { id: nurse.id } })).mfaEnabled).toBe(false);
  });
});

describe("password reset", () => {
  it("answers the same for unknown and known emails", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const known = await post("/api/auth/forgot-password", { email: user.userEmail });
    const unknown = await post("/api/auth/forgot-password", { email: "nobody@example.test" });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect((await latestAudit(facility.id))?.summary).toMatch(/email is not set up, so no link was sent/);
  });

  it("an admin-issued link works once, ends every session, and is audit-logged", async () => {
    const facility = await makeFacility();
    const admin = (await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } })).user;
    const { user: nurse, staff } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Abena Dery" } });
    const session = await signIn(nurse.userEmail, PASSWORD);

    const issued = await as(admin).post(`/api/facility/staff/${staff!.id}/reset-link`);
    expect(issued.status).toBe(200);
    expect((await latestAudit(facility.id))?.summary).toBe(
      "Kofi Bawa issued a password reset link for Abena Dery, valid for 30 minutes."
    );
    const token = decodeURIComponent(new URL(issued.body.url).searchParams.get("token")!);

    expect((await request(app).get(`/api/auth/reset-password/check?token=${encodeURIComponent(token)}`)).body.status).toBe("ok");

    const weak = await post("/api/auth/reset-password", { token, password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toBeTruthy();

    const done = await post("/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect((await post("/api/auth/refresh", {}, session.cookie)).status).toBe(401);
    expect((await post("/api/auth/login", { email: nurse.userEmail, password: NEW_PASSWORD })).status).toBe(200);

    const again = await post("/api/auth/reset-password", { token, password: "a different long passphrase" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("link_invalid");
  });

  it("an expired link is refused", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now - 61 * 60 * 1000);
    const { token } = makeResetToken(user.id, user.passwordHash);
    spy.mockRestore();
    const res = await post("/api/auth/reset-password", { token, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("link_expired");
  });

  it("an admin cannot issue a link for their own account or for staff without one", async () => {
    const facility = await makeFacility();
    const { user: admin, staff: adminStaff } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
    expect((await as(admin).post(`/api/facility/staff/${adminStaff!.id}/reset-link`)).status).toBe(409);
    const noAccount = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "X1", fullName: "Yaw Mensah", status: "ACTIVE" } });
    const r = await as(admin).post(`/api/facility/staff/${noAccount.id}/reset-link`);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("Yaw Mensah has no HealthFlow account yet.");
  });
});

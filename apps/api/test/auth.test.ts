import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, freshIp, makeFacility, makeUser, PASSWORD, prisma, resetDatabase, totp } from "./helpers.js";

beforeEach(resetDatabase);

function login(body: object, ip = freshIp()) {
  return request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send(body);
}

function cookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((v) => v.startsWith("hf_refresh="));
  if (!c) throw new Error("no session cookie set");
  return c.split(";")[0];
}

describe("sign-in", () => {
  it("a facility admin cannot skip MFA, and signs in with password plus code", async () => {
    const facility = await makeFacility();
    const { user, mfaSecret } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, mfa: true });
    const ip = freshIp();

    const step1 = await login({ email: user.userEmail, password: PASSWORD }, ip);
    expect(step1.status).toBe(200);
    expect(step1.body).toEqual({ mfaRequired: true });
    expect(step1.headers["set-cookie"]).toBeUndefined();

    const wrong = await login({ email: user.userEmail, password: PASSWORD, totp: "000000" }, ip);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("invalid_mfa");

    const ok = await login({ email: user.userEmail, password: PASSWORD, totp: totp(mfaSecret) }, ip);
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.user.role).toBe("FACILITY_ADMIN");
  });

  it("a facility admin without MFA set up is not let in", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, mfa: false });
    const res = await login({ email: user.userEmail, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("mfa_setup_required");
  });

  it("refresh restores the signed-in user, not only a token", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const signedIn = await login({ email: user.userEmail, password: PASSWORD });
    expect(signedIn.status).toBe(200);

    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookieFrom(signedIn));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user).toMatchObject({ id: user.id, email: user.userEmail, role: "STAFF" });
  });

  it("a transferred staff member cannot sign in", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    await prisma.userProfile.update({ where: { id: user.id }, data: { active: false } });
    const res = await login({ email: user.userEmail, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("account_inactive");
  });

  it("locks the account after 5 wrong passwords", async () => {
    const facility = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    for (let i = 0; i < 5; i++) {
      const r = await login({ email: user.userEmail, password: "wrong password" });
      expect(r.status).toBe(401);
    }
    const locked = await login({ email: user.userEmail, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe("account_locked");
  });
});

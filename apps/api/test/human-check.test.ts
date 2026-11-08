import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, makeFacility, makeUser, PASSWORD, freshIp, resetDatabase } from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-for-tests");
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key-for-tests");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const login = (email: string, extra: Record<string, string> = {}) =>
  request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({ email, password: PASSWORD, audience: "facility", ...extra });

function cloudflareSays(success: boolean) {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    String(url).includes("challenges.cloudflare.com") ? new Response(JSON.stringify({ success }), { status: 200 }) : real(url as string, init)));
}

describe("staff human check", () => {
  it("asks staff to prove they are a person once the password is right", async () => {
    const f = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Ama Nurse" } });
    const res = await login(user.userEmail);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "human_check_required", siteKey: "site-key-for-tests" });
  });

  it("does not tell a wrong password anything about the check", async () => {
    const f = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Ama Nurse" } });
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({ email: user.userEmail, password: "wrong password here", audience: "facility" });
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("lets staff in with a passing answer and refuses a failing one", async () => {
    const f = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Ama Nurse" } });
    cloudflareSays(false);
    expect((await login(user.userEmail, { humanToken: "x" })).body.error).toBe("human_check_failed");
    cloudflareSays(true);
    const ok = await login(user.userEmail, { humanToken: "x" });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it("never asks the roles that use an authenticator code", async () => {
    const f = await makeFacility();
    const { user } = await makeUser({ role: "FACILITY_ADMIN", facilityId: f.id, withStaff: { fullName: "Kofi Admin" }, mfa: true });
    const res = await login(user.userEmail);
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
  });

  it("is off until both keys are set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const f = await makeFacility();
    const { user } = await makeUser({ role: "STAFF", facilityId: f.id, withStaff: { fullName: "Ama Nurse" } });
    expect((await login(user.userEmail)).status).toBe(200);
  });
});

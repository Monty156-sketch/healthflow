import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app, freshIp, PASSWORD } from "./helpers.js";
import { signAccessToken, verifyAccessToken } from "../src/lib/tokens.js";

const payload = { sub: "u1", email: "a@b.gh", role: "STAFF", scopeType: "FACILITY", scopeId: null, facilityId: null } as const;

describe("token hardening", () => {
  it("signs and verifies HS256 tokens", () => {
    const t = signAccessToken({ ...payload } as never);
    expect(jwt.decode(t, { complete: true })?.header.alg).toBe("HS256");
    expect(verifyAccessToken(t).sub).toBe("u1");
  });
  it("refuses an unsigned token and one signed with another algorithm", () => {
    const none = jwt.sign(payload, "", { algorithm: "none" });
    expect(() => verifyAccessToken(none)).toThrow();
    const hs512 = jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS512" });
    expect(() => verifyAccessToken(hs512)).toThrow();
  });
});

describe("login rate limit", () => {
  it("allows ten failed tries per 15 minutes from one network, then stops", async () => {
    const ip = freshIp();
    const go = () => request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "nobody@x.gh", password: PASSWORD });
    for (let i = 0; i < 10; i++) expect((await go()).status).toBe(401);
    expect((await go()).status).toBe(429);
  }, 60000);
});

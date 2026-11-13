import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, freshIp, makeFacility, makeUser, PASSWORD, prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user } = await makeUser({ role: "STAFF", facilityId: facility.id, withStaff: { fullName: "Ama Dery" } });
  return { user, api: as(user) };
}

describe("fingerprint and face sign-in", () => {
  it("starts a sign-in without asking for an email, and a challenge works only once", async () => {
    const ip = freshIp();
    const first = await request(app).post("/api/auth/passkey-login/options").set("X-Forwarded-For", ip);
    expect(first.status).toBe(200);
    expect(first.body.options.challenge).toBeTruthy();
    expect(first.body.options.userVerification).toBe("required");
    const bogus = { id: "unknown-credential", rawId: "unknown-credential", type: "public-key", response: {}, clientExtensionResults: {} };
    const a = await request(app).post("/api/auth/passkey-login/verify").set("X-Forwarded-For", ip).send({ challengeId: first.body.challengeId, response: bogus });
    expect(a.status).toBe(401);
    expect(a.body.error).toBe("passkey_unknown");
    const again = await request(app).post("/api/auth/passkey-login/verify").set("X-Forwarded-For", ip).send({ challengeId: first.body.challengeId, response: bogus });
    expect(again.body.error).toBe("challenge_expired");
  });

  it("goes straight to the device's own prompt when the device names its key", async () => {
    const r = await request(app).post("/api/auth/passkey-login/options").set("X-Forwarded-For", freshIp()).send({ credentialId: "abc123" });
    expect(r.body.options.allowCredentials).toEqual([{ id: "abc123", transports: ["internal"] }]);
  });

  it("asks for the password before turning it on, and lists and removes a device", async () => {
    const { api, user } = await setup();
    expect((await api.get("/api/auth/account/passkeys")).body.passkeys).toEqual([]);
    expect((await api.post("/api/auth/account/passkeys/register/options", { password: "wrong password" })).status).not.toBe(200);
    const ok = await api.post("/api/auth/account/passkeys/register/options", { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.options.authenticatorSelection).toMatchObject({ authenticatorAttachment: "platform", userVerification: "required" });
    const key = await prisma.passkey.create({ data: { userProfileId: user.id, credentialId: "abc", publicKey: Buffer.from([1, 2, 3]), transports: ["internal"], deviceName: "Ama's phone" } });
    expect((await api.get("/api/auth/account/passkeys")).body.passkeys).toHaveLength(1);
    expect((await api.delete(`/api/auth/account/passkeys/${key.id}`)).status).toBe(200);
    expect(await prisma.passkey.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "passkey_removed" } })).toBe(1);
  });

  it("will not let one person remove another person's device", async () => {
    const { user } = await setup();
    const other = await makeUser({ role: "STAFF", facilityId: user.facilityId!, withStaff: { fullName: "Esi Naa" } });
    const key = await prisma.passkey.create({ data: { userProfileId: user.id, credentialId: "abc", publicKey: Buffer.from([1]), transports: [], deviceName: "Phone" } });
    expect((await as(other.user).delete(`/api/auth/account/passkeys/${key.id}`)).status).toBe(404);
    expect(await prisma.passkey.count()).toBe(1);
  });
});

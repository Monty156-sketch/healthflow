// Sign in with a fingerprint or face (passkeys, WebAuthn).
//
// The phone or computer keeps the private key behind its own lock (fingerprint, face or screen lock) and HealthFlow
// stores only the public key, so no biometric ever leaves the device. A passkey needs the device lock every time, so
// it counts as both factors: it stands in for the password and the authenticator code. Turning one on asks for the
// current password; turning it off needs nothing more than being signed in.
import { Router } from "express";
import { z } from "zod";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { describeDevice } from "../lib/userAgent.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLiveUser, liveUser } from "../middleware/liveUser.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { confirmPassword } from "./account.js";
import { startSession, publicUser } from "./auth.js";

const CHALLENGE_MINUTES = 5;
const RP_NAME = "HealthFlow";

/** The site the browser is on. A passkey belongs to this host, so the API reads it from WEB_ORIGIN. */
function relyingParty() {
  const origin = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  return { origin, id: new URL(origin).hostname };
}

async function newChallenge(kind: "REGISTER" | "SIGN_IN", challenge: string, userProfileId: string | null) {
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const row = await prisma.passkeyChallenge.create({ data: { challenge, kind, userProfileId, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000) } });
  return row.id;
}

/** A challenge can be used once: it is deleted the moment it is read. */
async function takeChallenge(id: string, kind: "REGISTER" | "SIGN_IN") {
  const row = await prisma.passkeyChallenge.findUnique({ where: { id } });
  if (!row) return null;
  await prisma.passkeyChallenge.deleteMany({ where: { id } });
  return row.kind === kind && row.expiresAt > new Date() ? row : null;
}

// ------------------------------------------------------------- turning it on and off (signed in)

export const passkeyAccountRouter = Router();
passkeyAccountRouter.use(requireAuth, requireLiveUser);

passkeyAccountRouter.get("/", async (req, res) => {
  const me = liveUser(req);
  const rows = await prisma.passkey.findMany({ where: { userProfileId: me.id }, orderBy: { createdAt: "asc" } });
  res.json({ passkeys: rows.map((p) => ({ id: p.id, deviceName: p.deviceName, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })) });
});

passkeyAccountRouter.post("/register/options", async (req, res) => {
  const me = liveUser(req);
  if (!(await confirmPassword(req, res, req.body?.password))) return;
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id }, include: { passkeys: { select: { credentialId: true, transports: true } } } });
  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: user.userEmail,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
    // This phone or computer only, and no passkey-manager picker: the device goes straight to the fingerprint or face prompt.
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
    preferredAuthenticatorType: "client-device",
  });
  res.json({ options, challengeId: await newChallenge("REGISTER", options.challenge, user.id) });
});

const registerInput = z.object({ challengeId: z.string().min(1), response: z.record(z.string(), z.unknown()), deviceName: z.string().trim().max(60).optional() });

passkeyAccountRouter.post("/register/verify", async (req, res) => {
  const me = liveUser(req);
  const parsed = registerInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const challenge = await takeChallenge(parsed.data.challengeId, "REGISTER");
  if (!challenge || challenge.userProfileId !== me.id) return res.status(400).json({ error: "challenge_expired", message: "That took too long. Try again." });
  const rp = relyingParty();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    return res.status(400).json({ error: "passkey_failed", message: "This device could not be set up. Try again." });
  }
  if (!verified.verified || !verified.registrationInfo) return res.status(400).json({ error: "passkey_failed", message: "This device could not be set up. Try again." });
  const { credential } = verified.registrationInfo;
  const name = parsed.data.deviceName || describeDevice(req.headers["user-agent"]);
  const saved = await prisma.passkey.create({
    data: { userProfileId: me.id, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], deviceName: name },
  });
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } });
  await writeAuditLog({
    facilityId: user.facilityId, actorEmail: user.userEmail, action: "passkey_added", entityType: "UserProfile", entityId: user.id,
    summary: `${user.userEmail} turned on fingerprint or face sign-in on ${name}.`,
  });
  res.status(201).json({ passkey: { id: saved.id, deviceName: saved.deviceName, createdAt: saved.createdAt, lastUsedAt: null } });
});

passkeyAccountRouter.delete("/:id", async (req, res) => {
  const me = liveUser(req);
  const row = await prisma.passkey.findFirst({ where: { id: String(req.params.id), userProfileId: me.id } });
  if (!row) return res.status(404).json({ error: "not_found" });
  await prisma.passkey.delete({ where: { id: row.id } });
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: me.id } });
  await writeAuditLog({
    facilityId: user.facilityId, actorEmail: user.userEmail, action: "passkey_removed", entityType: "UserProfile", entityId: user.id,
    summary: `${user.userEmail} turned off fingerprint or face sign-in on ${row.deviceName}.`,
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------- signing in (not signed in yet)

export const passkeyLoginRouter = Router();

/** No email is asked: the device offers the passkeys it holds for this site. */
passkeyLoginRouter.post("/options", loginLimiter, async (req, res) => {
  // The device remembers which key it made and says so, so the phone goes straight to the fingerprint or face prompt.
  // Nothing is looked up here, so this reveals nothing about who has an account.
  const known = typeof req.body?.credentialId === "string" && req.body.credentialId.length < 512 ? req.body.credentialId : null;
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().id,
    userVerification: "required",
    ...(known ? { allowCredentials: [{ id: known, transports: ["internal" as const] }] } : {}),
  });
  res.json({ options, challengeId: await newChallenge("SIGN_IN", options.challenge, null) });
});

const DOOR: Record<string, string> = { facility: "/login", district: "/district/login", platform: "/platform/login" };
const doorFor = (role: string) => (role === "PLATFORM_ADMIN" ? "platform" : role === "DISTRICT_OFFICER" ? "district" : "facility");

const loginInput = z.object({
  challengeId: z.string().min(1),
  response: z.object({ id: z.string().min(1) }).passthrough(),
  audience: z.enum(["facility", "district", "platform"]).optional(),
});

passkeyLoginRouter.post("/verify", loginLimiter, async (req, res) => {
  const parsed = loginInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const challenge = await takeChallenge(parsed.data.challengeId, "SIGN_IN");
  if (!challenge) return res.status(400).json({ error: "challenge_expired", message: "That took too long. Try again." });
  const passkey = await prisma.passkey.findUnique({ where: { credentialId: parsed.data.response.id }, include: { user: true } });
  if (!passkey) return res.status(401).json({ error: "passkey_unknown", message: "This device is not set up for fingerprint or face sign-in. Sign in with your password, then turn it on in Security." });
  const user = passkey.user;
  if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ error: "account_locked", lockedUntil: user.lockedUntil });
  const rp = relyingParty();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] },
      requireUserVerification: true,
    });
  } catch {
    return res.status(401).json({ error: "passkey_failed", message: "Fingerprint or face sign-in did not work. Use your password instead." });
  }
  if (!result.verified) return res.status(401).json({ error: "passkey_failed", message: "Fingerprint or face sign-in did not work. Use your password instead." });
  if (!user.active) return res.status(403).json({ error: "account_inactive" });
  if (parsed.data.audience && doorFor(user.role) !== parsed.data.audience) return res.status(403).json({ error: "wrong_door", goTo: DOOR[doorFor(user.role)] });
  await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  const accessToken = await startSession(req, res, user, "with a fingerprint or face");
  res.json({ accessToken, user: publicUser(user) });
});

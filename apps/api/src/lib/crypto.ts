// AES-256-GCM for columns the schema marks "(encrypted)" — MFA secrets and
// recovery codes at rest. Separate from password hashing, which is one-way;
// this is reversible because the server needs the plaintext TOTP secret to
// verify a six-digit code.
import crypto from "node:crypto";

function getKey(): Buffer {
  const b64 = process.env.MFA_ENCRYPTION_KEY;
  if (!b64) throw new Error("MFA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * A short, one-way label for the MFA key, printed by the API at startup and
 * by the seed script, so you can confirm both use the same key without
 * showing the key itself. Reveals nothing usable about the key.
 */
export function mfaKeyFingerprint(): string {
  try {
    return crypto.createHash("sha256").update(getKey()).digest("hex").slice(0, 8);
  } catch (err) {
    return `invalid (${(err as Error).message})`;
  }
}

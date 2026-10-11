import { authenticator } from "otplib";
import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function otpauthUrl(secret: string, email: string): string {
  return authenticator.keyuri(email, "HealthFlow", secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

/** Ten single-use recovery codes, shown once at setup, hashed at rest. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")
  );
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashPassword(c)));
}

export async function consumeRecoveryCode(
  hashedCodes: string[],
  submitted: string
): Promise<{ matched: boolean; remaining: string[] }> {
  for (const hash of hashedCodes) {
    if (await verifyPassword(hash, submitted)) {
      return { matched: true, remaining: hashedCodes.filter((h) => h !== hash) };
    }
  }
  return { matched: false, remaining: hashedCodes };
}

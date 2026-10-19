// The facility access code: HF- and six letters or digits, such as HF-FX8W8U.
// It is read aloud in meetings and written on notice boards, so it leaves out
// 0, O, 1, I and L, and it has no symbols that are hard to say or to type on
// a phone. Six characters from 31 give about 887 million codes.
import { randomInt } from "node:crypto";
import { prisma } from "./prisma.js";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const normaliseCode = (raw: string): string => raw.trim().toUpperCase().replace(/\s+/g, "");

export function makeCode(): string {
  let tail = "";
  for (let i = 0; i < 6; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `HF-${tail}`;
}

/** The one live code, if there is one. A paused code is still the facility's code. */
export function currentCode(facilityId: string) {
  return prisma.facilityAccessCode.findFirst({ where: { facilityId, revokedAt: null }, orderBy: { createdAt: "desc" } });
}

/** Makes a new code and revokes the old one, carrying the approval setting across. */
export async function issueCode(facilityId: string, by: string) {
  const old = await currentCode(facilityId);
  for (let tries = 0; tries < 8; tries++) {
    const code = makeCode();
    try {
      return await prisma.$transaction(async (tx) => {
        if (old) await tx.facilityAccessCode.update({ where: { id: old.id }, data: { active: false, revokedAt: new Date(), revokedBy: by } });
        return tx.facilityAccessCode.create({ data: { facilityId, code, createdBy: by, requiresApproval: old?.requiresApproval ?? true } });
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // a clash with another facility's code: try again
    }
  }
  throw new Error("Could not make a free access code.");
}

/** Why a code cannot be used right now, or null if it can. */
export function codeProblem(c: { active: boolean; revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; usesCount: number }): string | null {
  if (!c.active || c.revokedAt) return "off";
  if (c.expiresAt && c.expiresAt < new Date()) return "expired";
  if (c.maxUses !== null && c.usesCount >= c.maxUses) return "used_up";
  return null;
}

/** People who register without an email get a sign-in name made from their phone. The domain can never be a real mailbox. */
export const PHONE_LOGIN_DOMAIN = "phone.healthflow.invalid";
export const phoneLogin = (phone: string) => `${phone}@${PHONE_LOGIN_DOMAIN}`;
export const isPhoneLogin = (email: string) => email.endsWith(`@${PHONE_LOGIN_DOMAIN}`);

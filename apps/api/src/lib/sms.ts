// Text messages. A nurse on nights may not open the app all day, and some staff
// have no email, so the few messages that change someone's duties can also go
// by SMS. The provider is Arkesel (https://developers.arkesel.com). Nothing is
// sent unless the server has an API key and the facility has turned texting on,
// the person has a valid number and has not opted out. Every attempt is
// recorded, including the ones that were skipped and why.
import { prisma } from "./prisma.js";

export const smsConfigured = () => Boolean(process.env.SMS_API_KEY && process.env.SMS_SENDER_ID);

/** Texts a facility may send in one day. A bug or a loop must not run up a bill. */
export const DAILY_LIMIT = 300;
/** Longest text. Two SMS parts. */
const MAX_LENGTH = 300;

/** Ghana numbers to the form the gateway wants (233XXXXXXXXX), or null when it is not a usable mobile number. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s()\-.]/g, "").replace(/^\+/, "");
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^00233\d{9}$/.test(digits)) return digits.slice(2);
  return null;
}

export async function sendSms(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: { "api-key": process.env.SMS_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ sender: process.env.SMS_SENDER_ID, message: text, recipients: [to] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (res.ok && body.status === "success") return { ok: true };
    return { ok: false, error: (body.message ?? `The gateway answered ${res.status}.`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "The gateway could not be reached." };
  }
}

/**
 * Texts one staff member, if every condition holds. Never throws: a text that
 * fails must not stop the change that caused it.
 */
export async function textStaff(facilityId: string, staffId: string, type: string, body: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    const [facility, staff] = await Promise.all([
      prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true, smsEnabled: true } }),
      prisma.staff.findFirst({ where: { id: staffId, facilityId }, select: { phone: true, smsOptOut: true, status: true } }),
    ]);
    // "force" is for a message the person asked for by registering, such as the answer to their sign-up. It still honours an opt-out.
    if (!facility || !staff || staff.smsOptOut || (!facility.smsEnabled && !opts.force)) return;
    if (staff.status !== "ACTIVE" && staff.status !== "ON_LEAVE" && !opts.force) return;

    const to = normalisePhone(staff.phone);
    const text = `${facility.name}: ${body}`.slice(0, MAX_LENGTH);
    const log = (status: "SENT" | "FAILED" | "SKIPPED", error?: string) =>
      prisma.smsMessage.create({ data: { facilityId, staffId, toPhone: to ?? staff.phone ?? "", type, body: text, status, error: error ?? null } });

    if (!to) return; // not logged: the settings page already counts who has no usable number
    if (!smsConfigured()) return void (await log("SKIPPED", "Text messages are not set up on the server yet."));
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    if ((await prisma.smsMessage.count({ where: { facilityId, status: "SENT", createdAt: { gte: startOfDay } } })) >= DAILY_LIMIT) {
      return void (await log("SKIPPED", `The daily limit of ${DAILY_LIMIT} texts was reached.`));
    }
    const result = await sendSms(to, text);
    await log(result.ok ? "SENT" : "FAILED", result.error);
  } catch (e) {
    console.warn("A text message could not be handled:", e instanceof Error ? e.message : e);
  }
}

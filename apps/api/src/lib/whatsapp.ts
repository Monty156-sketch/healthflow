// WhatsApp duty reminders. A nurse on nights may not open the app all day, but WhatsApp is open on most phones.
// Each morning a person who has switched it on receives one message naming their shift for the day.
// Messages go through the WhatsApp Business Cloud API using an approved template (see RUNBOOK.md for the exact wording).
// Nothing is sent unless the server has the keys, the facility has turned reminders on, and the person has opted in
// themselves. Without keys this whole file does nothing. Every attempt is recorded.
import { prisma } from "./prisma.js";
import { asSystem, inFacilityRun } from "./tenant.js";
import { normalisePhone, DAILY_LIMIT } from "./sms.js";

export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const TEMPLATE = () => process.env.WHATSAPP_TEMPLATE || "duty_reminder";
const LANGUAGE = () => process.env.WHATSAPP_TEMPLATE_LANG || "en";
/** UTC is Ghana time. Reminders go out from this hour, so a night nurse hears before the day is gone. */
export const REMINDER_HOUR = 5;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

/** Sends the approved template with three values: the first name, the shift, the facility. */
export async function sendWhatsapp(to: string, values: [string, string, string]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: TEMPLATE(), language: { code: LANGUAGE() }, components: [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (res.ok && body.messages?.length) return { ok: true };
    return { ok: false, error: (body.error?.message ?? `WhatsApp answered ${res.status}.`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "WhatsApp could not be reached." };
  }
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
const times = (s: { startTime: string | null; endTime: string | null }) => (s.startTime && s.endTime ? ` (${s.startTime} to ${s.endTime})` : "");

/** The last three digits of a number, so a person can see which phone is meant without the number being shown. */
export const maskPhone = (raw: string | null | undefined) => {
  const n = normalisePhone(raw);
  return n ? `ending ${n.slice(-3)}` : null;
};

/**
 * Sends today's reminders for every facility that has them on. Returns how many went out.
 * Safe to run every hour: one row per person and day stops a repeat, and a failure is tried again up to three times.
 */
export async function runWhatsappReminders(now = new Date()): Promise<number> {
  if (!whatsappConfigured() || now.getUTCHours() < REMINDER_HOUR) return 0;
  const today = new Date(Math.floor(now.getTime() / DAY) * DAY);
  const facilities = await asSystem(() => prisma.facility.findMany({ where: { whatsappEnabled: true, status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true, name: true } }));
  let sent = 0;
  for (const f of facilities) sent += await inFacilityRun(f.id, async () => {
    let n = 0;
    let budget = DAILY_LIMIT - (await prisma.whatsappMessage.count({ where: { facilityId: f.id, status: "SENT", dutyDate: today } }));
    const duties = await prisma.rosterAssignment.findMany({
      where: {
        facilityId: f.id, dutyDate: today, roster: { status: "PUBLISHED" }, shift: { countsAsDuty: true },
        staff: { status: "ACTIVE", whatsappOptIn: true, phone: { not: null } },
      },
      select: { staffId: true, staff: { select: { fullName: true, phone: true } }, shift: { select: { name: true, startTime: true, endTime: true, sortOrder: true } } },
    });
    const byStaff = new Map<string, typeof duties>();
    for (const d of duties) byStaff.set(d.staffId, [...(byStaff.get(d.staffId) ?? []), d]);
    for (const [staffId, mine] of byStaff) {
      if (budget <= 0) break;
      const to = normalisePhone(mine[0].staff.phone);
      if (!to) continue;
      const prior = await prisma.whatsappMessage.findUnique({ where: { staffId_dutyDate_kind: { staffId, dutyDate: today, kind: "duty_today" } } });
      if (prior && (prior.status !== "FAILED" || prior.attempts >= MAX_ATTEMPTS)) continue;
      const shifts = [...mine].sort((a, b) => a.shift.sortOrder - b.shift.sortOrder).map((d) => `${d.shift.name}${times(d.shift)}`).join(" and ");
      const values: [string, string, string] = [firstName(mine[0].staff.fullName), shifts, f.name];
      const result = await sendWhatsapp(to, values);
      const data = { facilityId: f.id, staffId, toPhone: to, dutyDate: today, kind: "duty_today", body: `Hello ${values[0]}, you are on ${values[1]} today at ${values[2]}.`, status: result.ok ? ("SENT" as const) : ("FAILED" as const), error: result.error ?? null };
      if (prior) await prisma.whatsappMessage.update({ where: { id: prior.id }, data: { ...data, attempts: prior.attempts + 1 } });
      else await prisma.whatsappMessage.create({ data });
      if (result.ok) { n++; budget--; }
    }
    return n;
  });
  return sent;
}

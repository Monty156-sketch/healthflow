// Licences and certificates. A licence that has lapsed is a problem for the patient, the nurse and the
// facility alike, so the dates are watched here and the people who can act are told in good time.
import { prisma } from "./prisma.js";
import { notifyDeciders, notifyStaff } from "./notify.js";

/** Suggestions for the kind of credential. A facility may type any other. */
export const CREDENTIAL_KINDS = [
  "Nursing and Midwifery Council licence",
  "Medical and Dental Council licence",
  "Pharmacy Council licence",
  "Allied Health Professions Council licence",
  "Physician Assistant registration",
  "Annual practising licence",
  "Basic life support",
  "Advanced cardiac life support",
  "Fire safety training",
  "Infection prevention training",
  "Other",
];

const DAY = 86_400_000;
export const todayUtc = () => Math.floor(Date.now() / DAY);
export const dayOfDate = (d: Date) => Math.floor(d.getTime() / DAY);

export type CredentialState = "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY" | "NO_DATE";

/** Where a credential stands today. "Expiring" is within sixty days. */
export function stateOf(c: { expiresOn: Date | null; noExpiry: boolean }, today = todayUtc()): { state: CredentialState; daysLeft: number | null } {
  if (c.noExpiry) return { state: "NO_EXPIRY", daysLeft: null };
  if (!c.expiresOn) return { state: "NO_DATE", daysLeft: null };
  const daysLeft = dayOfDate(c.expiresOn) - today;
  return { state: daysLeft < 0 ? "EXPIRED" : daysLeft <= 60 ? "EXPIRING" : "VALID", daysLeft };
}

/** The reminder stage a credential has reached: 60, 30 or 7 days ahead, -1 once lapsed, 0 when none is due. */
export const stageFor = (daysLeft: number | null) => (daysLeft === null ? 0 : daysLeft < 0 ? -1 : daysLeft <= 7 ? 7 : daysLeft <= 30 ? 30 : daysLeft <= 60 ? 60 : 0);

/** A stage is sent once. Stages move toward the expiry: 60, then 30, then 7, then lapsed. */
const order = (s: number) => (s === 0 ? 0 : s === 60 ? 1 : s === 30 ? 2 : s === 7 ? 3 : 4);

/**
 * Tells each person whose licence is nearing its date or has lapsed, once per stage, and gives the
 * facility's managers one summary per facility. Returns how many people were told.
 */
export async function runCredentialReminders(now = new Date()): Promise<number> {
  const today = Math.floor(now.getTime() / DAY);
  const rows = await prisma.staffCredential.findMany({
    where: { archivedAt: null, noExpiry: false, expiresOn: { not: null, lte: new Date((today + 60) * DAY) }, staff: { status: "ACTIVE" } },
    include: { staff: { select: { fullName: true } } },
  });
  let told = 0;
  const byFacility = new Map<string, { expired: number; soon: number }>();
  for (const c of rows) {
    const { daysLeft } = stateOf(c, today);
    const stage = stageFor(daysLeft);
    if (order(stage) <= order(c.remindedStage)) continue;
    const lapsed = stage === -1;
    await notifyStaff(c.facilityId, c.staffId, {
      type: "credential_expiry",
      title: lapsed ? `Your ${c.kind} has lapsed` : `Your ${c.kind} lapses in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
      body: lapsed ? "Renew it and give your in-charge the new date so your record is up to date." : "Renew it in good time and give your in-charge the new date.",
      linkUrl: "/licences",
      severity: lapsed || stage === 7 ? "ACTION" : "INFO",
    });
    await prisma.staffCredential.update({ where: { id: c.id }, data: { remindedStage: stage } });
    told++;
    const f = byFacility.get(c.facilityId) ?? { expired: 0, soon: 0 };
    if (lapsed) f.expired++; else f.soon++;
    byFacility.set(c.facilityId, f);
  }
  for (const [facilityId, f] of byFacility) {
    await notifyDeciders(facilityId, {
      type: "credential_summary",
      title: `${f.expired + f.soon} ${f.expired + f.soon === 1 ? "licence needs" : "licences need"} attention`,
      body: `${f.expired} lapsed, ${f.soon} nearing the date. See Licences for who.`,
      linkUrl: "/licences",
      severity: f.expired ? "ACTION" : "INFO",
    });
  }
  return told;
}

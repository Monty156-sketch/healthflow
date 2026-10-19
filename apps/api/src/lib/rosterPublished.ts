// Tells staff their roster is out. Everyone with a duty on it hears: in the app
// if they have an account, and by text if the facility has texting on. Staff
// without an account still get the text, which is the point.
import { prisma } from "./prisma.js";
import { notifyStaff } from "./notify.js";
import { textStaff } from "./sms.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function notifyRosterPublished(facilityId: string, rosterId: string): Promise<number> {
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, facilityId }, select: { month: true, year: true } });
  if (!roster) return 0;
  const duties = await prisma.rosterAssignment.findMany({
    where: { rosterId, facilityId, shift: { countsAsDuty: true, isOnCall: false } },
    orderBy: { dutyDate: "asc" },
    select: { staffId: true, dutyDate: true, shift: { select: { name: true } } },
  });
  const byStaff = new Map<string, typeof duties>();
  for (const d of duties) byStaff.set(d.staffId, [...(byStaff.get(d.staffId) ?? []), d]);
  if (!byStaff.size) return 0;
  const withAccount = new Set((await prisma.userProfile.findMany({ where: { facilityId, staffId: { in: [...byStaff.keys()] }, active: true }, select: { staffId: true } })).map((u) => u.staffId));

  const month = `${MONTHS[roster.month - 1]} ${roster.year}`;
  let told = 0;
  for (const [staffId, mine] of byStaff) {
    const first = mine[0];
    const day = `${first.dutyDate.getUTCDate()} ${SHORT[first.dutyDate.getUTCMonth()]}`;
    const body = `Your ${month} duty roster is published: ${mine.length} ${mine.length === 1 ? "duty" : "duties"}, the first on ${day} (${first.shift.name}). Open My duties to see them all.`;
    if (withAccount.has(staffId)) await notifyStaff(facilityId, staffId, { type: "roster_published", title: `The ${month} roster is published`, body, linkUrl: "/my-duties" });
    else await textStaff(facilityId, staffId, "roster_published", body);
    told++;
  }
  return told;
}

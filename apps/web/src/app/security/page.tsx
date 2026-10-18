import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, PublicSection } from "@/components/PublicPage";

export const metadata: Metadata = { title: "Security | HealthFlow", description: "How HealthFlow protects the staff data a health facility puts into it." };

const GAP = "rounded-[3px] border border-dashed border-[var(--border-strong)] px-1 text-[var(--muted)]";
const A = "text-[var(--accent-text)] underline underline-offset-2";

export default function SecurityPage() {
  return (
    <PublicPage title="Security" intro="What we do to protect the staff information a facility puts into HealthFlow, and what we have not yet confirmed. Where a detail is not settled, the page says so rather than guessing.">
      <PublicSection title="What is in place">
        <ul className="list-disc space-y-2 pl-5">
          <li>Encryption in transit. Every connection to HealthFlow uses HTTPS.</li>
          <li>Role-based access with least privilege, enforced on the server and not only on the screen. Each staff member can see their own record and no one else&apos;s.</li>
          <li>Two-step sign-in with an authenticator app for every account.</li>
          <li>Account lockout after repeated failed sign-ins, and sessions that time out.</li>
          <li>Access is removed the moment a staff member is deactivated.</li>
          <li>An audit log of changes to rosters, staff and settings, readable by the facility administrator.</li>
          <li>Facilities are kept apart. A facility can only reach its own data.</li>
          <li>No medical information is stored. Leave records the type and the dates. There is no field for a condition, a diagnosis or a note.</li>
        </ul>
      </PublicSection>
      <PublicSection title="When PS Tech staff look at your data">
        <p>Our staff look at facility data only when necessary for support. Support access needs a written reason, expires on its own, and is recorded where the facility can see it.</p>
      </PublicSection>
      <PublicSection title="Where the data is held">
        <p>
          The server and the database are provided by named services, listed with their purpose in the <Link href="/privacy" className={A}>Privacy Policy</Link>. Hosting region: <span className={GAP}>To be confirmed: region</span>. Backups and the recovery objective: <span className={GAP}>To be confirmed</span>.
        </p>
      </PublicSection>
      <PublicSection title="Data Protection Commission">
        <p>
          PS Tech&apos;s registration as a data processor with the Data Protection Commission: <span className={GAP}>To be confirmed: registration status and number</span>.
        </p>
      </PublicSection>
      <PublicSection title="If something goes wrong">
        <p>If a breach affects a facility&apos;s data, we tell the facility without undue delay and within 48 hours of becoming aware of it. The terms are in the <Link href="/dpa" className={A}>Data Processing Agreement</Link>.</p>
      </PublicSection>
      <PublicSection title="Reporting a vulnerability">
        <p>
          If you find a weakness, write to <a href="mailto:muslimfroko05@gmail.com" className={A}>muslimfroko05@gmail.com</a> with what you found and how to see it. Please do not test against another facility&apos;s data. We will reply, and we will not take action against anyone who reports in good faith.
        </p>
      </PublicSection>
    </PublicPage>
  );
}

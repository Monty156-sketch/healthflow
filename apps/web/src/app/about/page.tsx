import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, PublicSection } from "@/components/PublicPage";

export const metadata: Metadata = { title: "About | HealthFlow", description: "HealthFlow is built by PS Tech, a software company in Wa, Upper West Region, Ghana." };

const A = "text-[var(--accent-text)] underline underline-offset-2";

export default function AboutPage() {
  return (
    <PublicPage title="About" intro="HealthFlow is built and run by PS Tech, a software company in Wa, in the Upper West Region of Ghana.">
      <PublicSection title="Who we are">
        <p>PS Tech builds software for businesses and institutions in Ghana: point-of-sale systems, online shops, and custom systems, and repairs and upgrades computers. HealthFlow is our product for health facilities.</p>
        <p>PS Tech is run by two partners, Muslim Mohammed Azerideen and Zaghe Joshua. The people who answer the phone are the people who build it.</p>
      </PublicSection>
      <PublicSection title="Why HealthFlow">
        <p>Duty rosters in health facilities are drawn by hand by people who are also treating patients. They take hours, and nothing checks them against leave, rest and the Labour Act until a problem appears on the ward. We built HealthFlow so that the roster is checked before it is published, and so that staff can see their own duties and how they were decided.</p>
      </PublicSection>
      <PublicSection title="Where it is being used">
        <p>HealthFlow is currently being piloted at Sombo Health Centre in the Nadowli-Kaleo District. We have no results to publish yet, and we will not publish any that we cannot show.</p>
      </PublicSection>
      <PublicSection title="Get in touch">
        <p>
          Call 055 457 1800 or 024 618 7422, or <Link href="/contact" className={A}>write to us</Link>. To start using HealthFlow, <Link href="/register" className={A}>register your facility</Link>.
        </p>
      </PublicSection>
    </PublicPage>
  );
}

import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { LegalLinks } from "@/components/LegalLinks";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service | HealthFlow" };

export default function TermsPage() {
  return (
    <>
      <LegalDocument doc={TERMS} other={{ href: "/privacy", label: "Read the Privacy Policy" }} />
      <LegalLinks className="pb-6" />
    </>
  );
}

import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy | HealthFlow" };

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} other={{ href: "/terms", label: "Read the Terms of Service" }} />;
}

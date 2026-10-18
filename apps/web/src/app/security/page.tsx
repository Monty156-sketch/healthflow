import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { SECURITY } from "@/lib/legal";

export const metadata: Metadata = { title: "Security | HealthFlow", description: "How HealthFlow protects the staff data a health facility puts into it." };

export default function SecurityPage() {
  return <LegalDocument slug="security" doc={SECURITY} other={{ href: "/privacy", label: "Read the Privacy Policy" }} />;
}

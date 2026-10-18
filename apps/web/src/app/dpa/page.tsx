import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { DPA } from "@/lib/legal";

export const metadata: Metadata = { title: "Data Processing Agreement | HealthFlow" };

export default function DpaPage() {
  return <LegalDocument doc={DPA} other={{ href: "/terms", label: "Read the Terms of Service" }} print />;
}

import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";
import { AccessRequestForm } from "@/components/AccessRequestForm";

export const metadata: Metadata = {
  title: "Request access | HealthFlow",
  description: "Ask for a demonstration of HealthFlow for your health facility. We reply within 48 hours.",
};

export default function RequestAccessPage() {
  return (
    <PublicPage
      title="Request access"
      intro="HealthFlow is set up with each facility, not through self-sign-up. Tell us about your facility and we will arrange a demonstration. A facility can only start using HealthFlow once an agreement is in place and its shifts, cadres and rules are set up."
    >
      <AccessRequestForm />
    </PublicPage>
  );
}

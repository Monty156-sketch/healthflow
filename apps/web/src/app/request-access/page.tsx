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
      intro="Want to see HealthFlow before you register? Tell us about your facility and we will arrange a demonstration. Ready to start? Register your facility at /register and get your staff access code straight away."
    >
      <AccessRequestForm />
    </PublicPage>
  );
}

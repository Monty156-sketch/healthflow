import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";
import { DistrictRegisterForm } from "@/components/DistrictRegisterForm";

export const metadata: Metadata = {
  title: "Register a district | HealthFlow",
  description: "Register a district health directorate on HealthFlow so its facilities can join it.",
};

export default function RegisterDistrictPage() {
  return (
    <PublicPage
      title="Register your district"
      intro="A district directorate registers once. After we check the details, facilities in the district can choose it when they ask for access, and appear in your list. You see a facility's coverage, establishment and leave only when that facility grants it."
    >
      <DistrictRegisterForm />
    </PublicPage>
  );
}

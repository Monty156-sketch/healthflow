import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";
import { RegionRegisterForm } from "@/components/RegionRegisterForm";

export const metadata: Metadata = {
  title: "Register a regional office | HealthFlow",
  description: "Register a regional health office on HealthFlow so districts can report to it.",
};

export default function RegisterRegionPage() {
  return (
    <PublicPage
      title="Register your regional office"
      intro="A regional office registers once. After PS Tech checks the details, districts under the same agency can choose it, and you approve each one. You see a facility's coverage, establishment and leave only when that facility has chosen to share it."
    >
      <RegionRegisterForm />
    </PublicPage>
  );
}

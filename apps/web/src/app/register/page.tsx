import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";
import { FacilityRegisterForm } from "@/components/FacilityRegisterForm";

export const metadata: Metadata = {
  title: "Register your facility | HealthFlow",
  description: "Register your health facility on HealthFlow and get a staff access code.",
};

export default function RegisterPage() {
  return (
    <PublicPage title="Register your facility" intro="Create your facility and your administrator account. When you finish, you get a staff access code to give your team. Your facility starts on a trial.">
      <FacilityRegisterForm />
    </PublicPage>
  );
}

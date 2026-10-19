import type { Metadata } from "next";
import { SignInScreen } from "@/components/SignInScreen";

export const metadata: Metadata = { title: "District sign-in | HealthFlow" };

export default function DistrictLoginPage() {
  return <SignInScreen audience="district" />;
}

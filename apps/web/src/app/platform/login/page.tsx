import type { Metadata } from "next";
import { SignInScreen } from "@/components/SignInScreen";

export const metadata: Metadata = { title: "Platform sign-in | HealthFlow", robots: { index: false, follow: false } };

export default function PlatformLoginPage() {
  return <SignInScreen audience="platform" />;
}

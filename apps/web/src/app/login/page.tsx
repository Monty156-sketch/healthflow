import type { Metadata } from "next";
import { SignInScreen } from "@/components/SignInScreen";

export const metadata: Metadata = { title: "Sign in | HealthFlow" };

export default function LoginPage() {
  return <SignInScreen audience="facility" />;
}

import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

// Signed-in pages are private: keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

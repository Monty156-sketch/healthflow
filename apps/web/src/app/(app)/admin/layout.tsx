"use client";

import { notFound } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/** The console exists only for platform accounts. Anyone else gets the same page as a route that is not there. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== "PLATFORM_ADMIN") notFound();
  return <>{children}</>;
}

"use client";

// While someone is clocked in, a bar on every page says so, and says when it is time to clock out.
// It is hidden on the two pages that already show the clock card.
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { CLOCK_EVENT, clockOutReason, clockTime, type ClockView } from "@/components/clockState";

export function ClockStatusBar({ role }: { role: string }) {
  const pathname = usePathname();
  const [view, setView] = useState<ClockView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Read again on each page and when the window is opened again, and at once when the card changes it.
  useEffect(() => {
    let live = true;
    const load = () => api.get<ClockView>("/api/facility/me/clock").then((v) => live && setView(v)).catch(() => undefined);
    const onCard = (e: Event) => setView((e as CustomEvent<ClockView>).detail);
    const onShow = () => document.visibilityState === "visible" && load();
    load();
    window.addEventListener(CLOCK_EVENT, onCard);
    document.addEventListener("visibilitychange", onShow);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      window.removeEventListener(CLOCK_EVENT, onCard);
      document.removeEventListener("visibilitychange", onShow);
      clearInterval(t);
    };
  }, [pathname]);

  if (!view?.linked || !view.enabled || view.state !== "IN" || !view.lastAt) return null;
  if (pathname === "/today" || pathname === "/dashboard") return null;
  const reason = clockOutReason(view, now);
  const home = role === "STAFF" ? "/today" : "/dashboard";
  return (
    <div role="status" className={`no-print flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-[15px] ${reason ? "border-[var(--status-warning)] bg-[var(--status-warning-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
      <span>
        <strong>You are clocked in</strong> since {clockTime(view.lastAt)}. {reason ?? "Clock out when you leave."}
      </span>
      <Link href={home} className="min-h-8 font-medium text-[var(--accent-text)] underline underline-offset-2">Go to clock out</Link>
    </div>
  );
}

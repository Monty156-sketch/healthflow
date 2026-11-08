"use client";

// Clock in and out at the facility. The phone's position is sent once to be checked against the
// facility's area and is not kept; only the clock times are.
// After a tap the card says plainly what happened, and while the person is clocked in it says how long
// and, once their duty is over, tells them to clock out. The same state shows as a bar on every page.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Notice } from "@/components/ui";
import { bestPosition } from "@/lib/position";
import { announceClock, clockOutReason, clockTime, hoursAndMinutes, type ClockView } from "@/components/clockState";

export function ClockCard({ compact = false }: { compact?: boolean }) {
  const { data, setData } = useResource<ClockView>("/api/facility/me/clock");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sure, setSure] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Keeps "how long" and the clock-out reminder current while the page stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!data?.linked || !data.enabled) return null;
  const view = data;
  const isIn = view.state === "IN";

  async function go() {
    setBusy(true);
    setProblem(null);
    setDone(null);
    setSure(null);
    try {
      // Listens for a few seconds and sends the sharpest reading, not the first rough one from the network.
      const p = await bestPosition({ maxMs: 12_000, goodEnoughM: 30, onUpdate: (f) => setSure(Math.round(f.accuracy)) });
      const next = await api.post<ClockView>("/api/facility/me/clock", { kind: isIn ? "OUT" : "IN", lat: p.lat, lng: p.lng, accuracy: p.accuracy });
      const merged = { ...view, ...next };
      setData(merged);
      announceClock(merged);
      const at = next.lastAt ? clockTime(next.lastAt) : "";
      setDone(next.state === "IN" ? `You clocked in at ${at}. Remember to clock out when you leave.` : `You clocked out at ${at}. Your day at the facility is recorded.`);
    } catch (e) {
      if (e instanceof ApiError) setProblem((e.body as { message?: string } | undefined)?.message ?? "It could not be saved. Try again.");
      else if (e instanceof Error && e.message === "unsupported") setProblem("This phone cannot share its location.");
      else setProblem("Your location could not be read. Allow location for this site and try again.");
    } finally {
      setBusy(false);
    }
  }

  const reason = clockOutReason(view, now);
  const since = isIn && view.lastAt ? `Since ${clockTime(view.lastAt)}, ${hoursAndMinutes(view.lastAt, now)} so far.` : "Do this when you arrive at the facility.";
  return (
    <div className="mb-6">
      {compact ? (
        <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`size-2.5 rounded-full ${isIn ? "bg-[var(--status-success)]" : "bg-[var(--border-strong)]"}`} />
              <div>
                <h2 className="text-base font-semibold">{isIn ? "You are clocked in" : "Clock in"}</h2>
                <p className="text-sm text-[var(--muted)]">{since}</p>
              </div>
            </div>
            <Button className="min-h-11 w-full sm:w-auto sm:min-w-40" disabled={busy} variant={isIn ? "secondary" : "primary"} onClick={go}>
              {busy ? (sure !== null ? `Checking… within ${sure} m` : "Checking where you are…") : isIn ? "Clock out" : "Clock in"}
            </Button>
          </div>
          {(done || problem || reason) && (
            <div className="mt-3 space-y-2">
              {done && <Notice tone="success">{done}</Notice>}
              {problem && <Notice tone="warning">{problem}</Notice>}
              {reason && <Notice tone="warning">{reason}</Notice>}
            </div>
          )}
        </section>
      ) : (
      <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${isIn ? "bg-[var(--status-success)]" : "bg-[var(--border-strong)]"}`} />
          <h2 className="text-base font-semibold">{isIn ? "You are clocked in" : "Clock in"}</h2>
        </div>
        <p className="mt-1 text-[15px] text-[var(--muted)]">{since}</p>
        <div className="mt-4 space-y-3">
          {done && <Notice tone="success">{done}</Notice>}
          {problem && <Notice tone="warning">{problem}</Notice>}
          {reason && <Notice tone="warning">{reason}</Notice>}
          <Button className="min-h-14 w-full text-lg" disabled={busy} variant={isIn ? "secondary" : "primary"} onClick={go}>
            {busy ? (sure !== null ? `Checking where you are… within ${sure} m` : "Checking where you are…") : isIn ? "Clock out" : "Clock in"}
          </Button>
          <p className="text-sm text-[var(--muted)]">Your location is checked once and is not kept.</p>
        </div>
      </section>
      )}
    </div>
  );
}

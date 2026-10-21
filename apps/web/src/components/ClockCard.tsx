"use client";

// Clock in and out at the facility. The phone's position is sent once to be checked against the
// facility's area and is not kept; only the clock times are.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Notice, Panel } from "@/components/ui";

interface Clock { linked: boolean; enabled?: boolean; state?: "IN" | "OUT"; lastAt?: string | null }

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}

export function ClockCard() {
  const { data, reload } = useResource<Clock>("/api/facility/me/clock");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!data?.linked || !data.enabled) return null;
  const isIn = data.state === "IN";

  async function go() {
    setBusy(true);
    setProblem(null);
    try {
      const p = await position();
      await api.post("/api/facility/me/clock", { kind: isIn ? "OUT" : "IN", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      reload();
    } catch (e) {
      if (e instanceof ApiError) setProblem((e.body as { message?: string } | undefined)?.message ?? "It could not be saved. Try again.");
      else if (e instanceof Error && e.message === "unsupported") setProblem("This phone cannot share its location.");
      else setProblem("Your location could not be read. Allow location for this site and try again.");
    } finally {
      setBusy(false);
    }
  }

  const since = data.lastAt ? new Date(data.lastAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : null;
  return (
    <div className="mb-6">
      <Panel title={isIn ? "You are clocked in" : "Clock in"} description={isIn && since ? `Since ${since}.` : "Do this when you arrive at the facility."}>
        {problem && <div className="mb-3"><Notice tone="warning">{problem}</Notice></div>}
        <Button className="min-h-12 w-full sm:w-auto" disabled={busy} variant={isIn ? "secondary" : "primary"} onClick={go}>
          {busy ? "Checking where you are…" : isIn ? "Clock out" : "Clock in"}
        </Button>
        <p className="mt-3 text-sm text-[var(--muted)]">Your location is checked once and is not kept.</p>
      </Panel>
    </div>
  );
}

"use client";

// Where the facility is, so staff can clock in and out. Set by standing at the facility and using this
// device's location, or by typing the coordinates.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Field, Input, Notice, Panel } from "@/components/ui";

interface Fence { set: boolean; lat: number | null; lng: number | null; radiusM: number | null }

export function GeofenceSettings() {
  const { data, reload } = useResource<Fence>("/api/facility/geofence");
  const [lat, setLat] = useState<string | null>(null);
  const [lng, setLng] = useState<string | null>(null);
  const [radius, setRadius] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!data) return null;
  const v = { lat: lat ?? (data.lat === null ? "" : String(data.lat)), lng: lng ?? (data.lng === null ? "" : String(data.lng)), radius: radius ?? String(data.radiusM ?? 150) };

  function here() {
    setMsg(null);
    if (!navigator.geolocation) return setMsg({ tone: "warning", text: "This device cannot share its location. Type the coordinates instead." });
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); },
      () => setMsg({ tone: "warning", text: "The location could not be read. Allow location for this site, or type the coordinates." }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setFields({});
    try {
      await api.put("/api/facility/geofence", { lat: Number(v.lat), lng: Number(v.lng), radiusM: Number(v.radius) });
      setMsg({ tone: "success", text: "Saved. Staff can now clock in and out within this area." });
      setLat(null); setLng(null); setRadius(null);
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string> } | undefined) : undefined;
      setFields(b?.fields ?? {});
      setMsg({ tone: "warning", text: b?.fields ? "Check the figures below." : "It was not saved. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try { await api.delete("/api/facility/geofence"); setLat(null); setLng(null); setRadius(null); setMsg({ tone: "success", text: "Clocking in and out is off." }); reload(); } finally { setBusy(false); }
  }

  return (
    <Panel title="Clock in and out" description={data.set ? "On. Staff clock in and out within the area below." : "Off. Stand at the facility, use this device's location and save, and staff can clock in and out there."}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Latitude" error={fields.lat}>{(a) => <Input {...a} className="figures" inputMode="decimal" value={v.lat} onChange={(e) => setLat(e.target.value)} />}</Field>
        <Field label="Longitude" error={fields.lng}>{(a) => <Input {...a} className="figures" inputMode="decimal" value={v.lng} onChange={(e) => setLng(e.target.value)} />}</Field>
        <Field label="Distance from the centre, in metres" hint="Between 30 and 1,000." error={fields.radiusM}>{(a) => <Input {...a} className="figures" inputMode="numeric" value={v.radius} onChange={(e) => setRadius(e.target.value)} />}</Field>
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={here}>Use this device&apos;s location</Button>
        <Button disabled={busy || !v.lat || !v.lng} onClick={save}>Save area</Button>
        {data.set && <Button variant="quiet" disabled={busy} onClick={turnOff}>Turn off</Button>}
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">Staff are asked for their location only when they clock in or out. It is checked once and not kept; only the time and the distance from the centre are.</p>
    </Panel>
  );
}

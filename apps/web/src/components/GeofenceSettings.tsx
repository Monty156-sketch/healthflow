"use client";

// Where the facility is, so staff can clock in and out. Set by standing at the facility and using this
// device's location, or by typing the coordinates.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Field, Input, Notice, Panel, Select } from "@/components/ui";

const RADII = [50, 100, 150, 200, 300, 500, 750, 1000];

interface Fence { set: boolean; lat: number | null; lng: number | null; radiusM: number | null }

export function GeofenceSettings() {
  const { data, reload } = useResource<Fence>("/api/facility/geofence");
  const [lat, setLat] = useState<string | null>(null);
  const [lng, setLng] = useState<string | null>(null);
  const [radius, setRadius] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!data) return null;
  const v = { lat: lat ?? (data.lat === null ? "" : String(data.lat)), lng: lng ?? (data.lng === null ? "" : String(data.lng)), radius: radius ?? String(data.radiusM ?? 150) };

  function here() {
    setMsg(null);
    if (!navigator.geolocation) return setMsg({ tone: "warning", text: "This device cannot share its location. Open this page on a phone, or type the coordinates." });
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setAccuracy(Math.round(p.coords.accuracy));
        setCapturing(false);
      },
      () => {
        setCapturing(false);
        setMsg({ tone: "warning", text: "The location could not be read. Allow location for this site and try again, or type the coordinates." });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
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
    <Panel title="Clock in and out" description={data.set ? "On. Staff clock in and out within the area below." : "Off. Capture the facility's location, choose the distance, and save."}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[15px] font-medium">1. Stand at the centre of the facility</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Use a phone, outside if you can, and wait a moment for a good fix.</p>
          <div className="mt-3">
            <Button variant="secondary" disabled={busy || capturing} onClick={here}>{capturing ? "Reading location…" : v.lat && v.lng ? "Capture again" : "Capture this location"}</Button>
          </div>
          {v.lat && v.lng && (
            <p className="figures mt-3 text-[15px]">
              {v.lat}, {v.lng}
              {accuracy !== null && <span className="block text-sm text-[var(--muted)]">Accurate to about {accuracy} metres{accuracy > 50 ? ". That is wide; capture again outside." : "."}</span>}
            </p>
          )}
        </div>
        <Field label="2. How far from the centre staff may clock in" error={fields.radiusM}>
          {(a) => (
            <Select {...a} value={RADII.includes(Number(v.radius)) ? v.radius : "custom"} onChange={(e) => e.target.value !== "custom" && setRadius(e.target.value)}>
              {RADII.map((r) => <option key={r} value={r}>{r.toLocaleString()} metres</option>)}
              {!RADII.includes(Number(v.radius)) && <option value="custom">{v.radius} metres</option>}
            </Select>
          )}
        </Field>
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">Type the coordinates instead</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Latitude" error={fields.lat}>{(a) => <Input {...a} className="figures" inputMode="decimal" value={v.lat} onChange={(e) => setLat(e.target.value)} />}</Field>
          <Field label="Longitude" error={fields.lng}>{(a) => <Input {...a} className="figures" inputMode="decimal" value={v.lng} onChange={(e) => setLng(e.target.value)} />}</Field>
          <Field label="Distance in metres" hint="Between 30 and 1,000." error={fields.radiusM}>{(a) => <Input {...a} className="figures" inputMode="numeric" value={v.radius} onChange={(e) => setRadius(e.target.value)} />}</Field>
        </div>
      </details>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy || !v.lat || !v.lng} onClick={save}>Save area</Button>
        {data.set && <Button variant="quiet" disabled={busy} onClick={turnOff}>Turn off</Button>}
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">Staff are asked for their location only when they clock in or out. It is checked once and not kept; only the time and the distance from the centre are.</p>
    </Panel>
  );
}

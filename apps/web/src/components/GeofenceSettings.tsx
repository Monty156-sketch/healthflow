"use client";

// Where the facility is, so staff can clock in and out. Set by standing at the facility and using this
// device's location, or by typing the coordinates.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { bestPosition, parseCoordinates } from "@/lib/position";
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
  const [live, setLive] = useState<number | null>(null);
  if (!data) return null;
  const v = { lat: lat ?? (data.lat === null ? "" : String(data.lat)), lng: lng ?? (data.lng === null ? "" : String(data.lng)), radius: radius ?? String(data.radiusM ?? 150) };

  function here() {
    setMsg(null);
    setLive(null);
    setCapturing(true);
    // Listens for up to 25 seconds and keeps the sharpest reading, so a rough first guess from the network is not used.
    bestPosition({ maxMs: 25_000, goodEnoughM: 20, onUpdate: (f) => setLive(Math.round(f.accuracy)) })
      .then((f) => {
        setLat(f.lat.toFixed(6));
        setLng(f.lng.toFixed(6));
        setAccuracy(Math.round(f.accuracy));
      })
      .catch((e) => {
        const unsupported = e instanceof Error && e.message === "unsupported";
        setMsg({ tone: "warning", text: unsupported ? "This device cannot share its location. Open this page on a phone, or type the coordinates." : "The location could not be read. Allow location for this site and try again, or type the coordinates." });
      })
      .finally(() => setCapturing(false));
  }

  function pasted(text: string) {
    const c = parseCoordinates(text);
    if (!c) return;
    setLat(String(c.lat));
    setLng(String(c.lng));
    setAccuracy(null);
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
            <Button variant="secondary" disabled={busy || capturing} onClick={here}>{capturing ? (live !== null ? `Improving… within ${live} m` : "Reading location…") : v.lat && v.lng ? "Capture again" : "Capture this location"}</Button>
          </div>
          <label className="mt-3 block text-sm text-[var(--muted)]">
            Or paste the coordinates from a map (in Google Maps, press and hold the centre of the building, then copy the two numbers)
            <Input className="mt-1" inputMode="decimal" placeholder="7.123456, -2.123456" onChange={(e) => pasted(e.target.value)} />
          </label>
          {v.lat && v.lng && (
            <p className="figures mt-3 text-[15px]">
              {v.lat}, {v.lng}
              {accuracy !== null && <span className="block text-sm text-[var(--muted)]">Accurate to about {accuracy} metres{accuracy > 100 ? ". That is too wide to save: a wrong centre makes staff look outside. Capture again outside, with GPS on." : accuracy > 50 ? ". That is wide; capture again outside." : "."}</span>}
              {Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng)) && (
                <a className="mt-1 block text-sm text-[var(--accent-text)] underline underline-offset-2" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">Check this spot on a map</a>
              )}
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
        <Button disabled={busy || !v.lat || !v.lng || (accuracy !== null && accuracy > 100)} onClick={save}>Save area</Button>
        {data.set && <Button variant="quiet" disabled={busy} onClick={turnOff}>Turn off</Button>}
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">Staff are asked for their location only when they clock in or out. It is checked once and not kept; only the time and the distance from the centre are.</p>
    </Panel>
  );
}

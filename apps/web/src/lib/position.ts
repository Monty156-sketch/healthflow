// The phone's first position is often a rough one from the mobile network, which can place it in a town far away.
// Waiting a few seconds lets the GPS settle, so this keeps listening and returns the most accurate reading it saw.

export interface Fix { lat: number; lng: number; accuracy: number }

/**
 * Listens for up to `maxMs`, calling `onUpdate` with the best fix so far, and settles as soon as a reading is as
 * sharp as `goodEnoughM`. If time runs out it returns the best reading it has; with none, it rejects.
 */
export function bestPosition(opts: { maxMs?: number; goodEnoughM?: number; onUpdate?: (fix: Fix) => void } = {}): Promise<Fix> {
  const { maxMs = 20_000, goodEnoughM = 25, onUpdate } = opts;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    let best: Fix | null = null;
    let done = false;
    let watch = -1;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(err ?? new Error("no_position"));
    };
    const timer = setTimeout(() => finish(), maxMs);
    const take = (p: GeolocationPosition) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      if (!best || fix.accuracy < best.accuracy) {
        best = fix;
        onUpdate?.(fix);
      }
      if (fix.accuracy <= goodEnoughM) finish();
    };
    // Indoors the GPS often gives nothing, so a rough reading from wifi and the mobile network is asked for at the same time.
    // If both fail, the first error is reported; if either succeeds, the best reading wins.
    let failed = 0;
    let firstError: unknown;
    const failedOne = (e: unknown) => {
      firstError ??= e;
      if (++failed >= 2 && !best) finish(firstError);
    };
    navigator.geolocation.getCurrentPosition(take, failedOne, { enableHighAccuracy: false, timeout: maxMs, maximumAge: 30_000 });
    watch = navigator.geolocation.watchPosition(take, failedOne, { enableHighAccuracy: true, timeout: maxMs, maximumAge: 0 });
  });
}

/** Reads "7.123456, -2.123456" as copied from a map. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

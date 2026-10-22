export interface Reading {
  scope: string;
  facilities: { id: string; name: string }[];
  sentence: string;
  suspended?: { id: string; name: string; reason: string | null }[];
}

/** Every district screen says which facility grants it is reading under. */
export function DistrictReading({ reading }: { reading: Reading }) {
  return (
    <div className="mb-4 text-sm text-[var(--muted)]">
      <p>
        {reading.sentence}
        {reading.facilities.length > 0 && <> {reading.facilities.map((f) => f.name).join(", ")}.</>}
      </p>
      {reading.suspended && reading.suspended.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {reading.suspended.map((s) => <li key={s.id}><strong className="font-medium text-[var(--foreground)]">{s.name}</strong> is suspended by PS Tech, so nothing from it is shown.{s.reason ? ` Reason: ${s.reason}.` : ""}</li>)}
        </ul>
      )}
    </div>
  );
}

export interface Reading {
  scope: string;
  facilities: { id: string; name: string }[];
  sentence: string;
}

/** Every district screen says which facility grants it is reading under. */
export function DistrictReading({ reading }: { reading: Reading }) {
  return (
    <p className="mb-4 text-sm text-[var(--muted)]">
      {reading.sentence}
      {reading.facilities.length > 0 && <> {reading.facilities.map((f) => f.name).join(", ")}.</>}
    </p>
  );
}

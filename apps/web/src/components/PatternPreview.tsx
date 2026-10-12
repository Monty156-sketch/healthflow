// A 28-day picture of "N duties, then M days off", repeating. Filled blocks
// are duty days, hollow blocks are days off, so the pattern reads without
// relying on colour.
export function PatternPreview({ duties, off, colour }: { duties: number; off: number; colour: string }) {
  const valid = Number.isInteger(duties) && Number.isInteger(off) && duties >= 1 && off >= 1;
  const cells = Array.from({ length: 28 }, (_, i) => (valid ? i % (duties + off) < duties : false));
  const label = valid
    ? `28-day pattern: ${duties} duty ${duties === 1 ? "day" : "days"}, then ${off} ${off === 1 ? "day" : "days"} off, repeating.`
    : "Enter whole numbers to see the pattern.";
  return (
    <figure className="m-0">
      <div role="img" aria-label={label} className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(14,minmax(0,1fr))]">
        {cells.map((isDuty, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="block h-7 rounded-[4px]"
            style={
              valid
                ? isDuty
                  ? { background: colour, border: `1.5px solid ${colour}` }
                  : { background: "transparent", border: `1.5px solid ${colour}` }
                : { border: "1px dashed var(--border-strong)" }
            }
          />
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3.5 rounded-[3px]" style={{ background: colour }} /> Duty day
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3.5 rounded-[3px]" style={{ border: `1.5px solid ${colour}` }} /> Day off
        </span>
        <span>{label}</span>
      </figcaption>
    </figure>
  );
}

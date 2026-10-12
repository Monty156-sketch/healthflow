// A worked example of a rule, one box per day, using the facility's own shift
// codes. It shows what the roster engine will aim for: the block in the order
// set, the days off, and the shift staff come back on.
interface ShiftLite {
  id: string;
  code: string;
  name: string;
  colour: string | null;
}

export function buildStrip(opts: { duties: number; off: number; pattern: string[]; afterRest: string | null; days?: number }) {
  const { duties, off, pattern, afterRest } = opts;
  const days = opts.days ?? 14;
  if (!Number.isInteger(duties) || !Number.isInteger(off) || duties < 1 || off < 1) return [];
  const out: { kind: "duty" | "off"; shiftId: string | null }[] = [];
  let block = 0;
  while (out.length < days) {
    for (let i = 0; i < duties && out.length < days; i++) {
      let id: string | null = pattern.length ? pattern[i % pattern.length] : null;
      if (i === 0 && block > 0 && afterRest) id = afterRest;
      out.push({ kind: "duty", shiftId: id });
    }
    for (let i = 0; i < off && out.length < days; i++) out.push({ kind: "off", shiftId: null });
    block++;
  }
  return out;
}

export function ShiftStrip({ cells, shifts }: { cells: ReturnType<typeof buildStrip>; shifts: ShiftLite[] }) {
  if (!cells.length) return null;
  const label = cells
    .map((c, i) => `Day ${i + 1}: ${c.kind === "off" ? "off" : shifts.find((s) => s.id === c.shiftId)?.name ?? "any duty shift"}`)
    .join(". ");
  return (
    <ol aria-label={label} className="m-0 grid list-none grid-cols-7 gap-1 p-0 sm:grid-cols-[repeat(14,minmax(0,1fr))]">
      {cells.map((c, i) => {
        const s = c.shiftId ? shifts.find((x) => x.id === c.shiftId) : null;
        const colour = s?.colour ?? "#5b6770";
        return (
          <li
            key={i}
            aria-hidden="true"
            className="figures flex h-11 flex-col items-center justify-center rounded-[4px] text-[11px] leading-tight"
            style={c.kind === "off" ? { border: "1.5px dashed var(--border-strong)", color: "var(--muted)" } : { border: `1.5px solid ${colour}`, borderLeftWidth: 5 }}
          >
            <span className="text-[10px] text-[var(--muted)]">{i + 1}</span>
            <span className="font-semibold">{c.kind === "off" ? "Off" : s?.code ?? "Duty"}</span>
          </li>
        );
      })}
    </ol>
  );
}

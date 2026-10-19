// An example roster, drawn the way the product draws it: staff down the side,
// days across, duty chips, and a statutory finding on the row that breaks it.
// The names and duties are invented for the picture and the picture says so.
const DAYS = ["Mon 6", "Tue 7", "Wed 8", "Thu 9", "Fri 10", "Sat 11", "Sun 12"];

type Cell = "M" | "A" | "N" | "";
const ROWS: { name: string; cadre: string; cells: Cell[]; finding?: { from: number; to: number; text: string } }[] = [
  { name: "Staff A", cadre: "Midwife", cells: ["M", "M", "", "", "A", "A", ""] },
  { name: "Staff B", cadre: "Midwife", cells: ["N", "A", "", "", "M", "M", ""], finding: { from: 0, to: 1, text: "Six hours between shifts." } },
  { name: "Staff C", cadre: "Nurse", cells: ["", "A", "A", "N", "N", "", ""] },
  { name: "Staff D", cadre: "Nurse", cells: ["A", "", "M", "M", "", "N", "N"] },
];

const NAME: Record<Exclude<Cell, "">, string> = { M: "Morning", A: "Afternoon", N: "Night" };
const COLOUR: Record<Exclude<Cell, "">, string> = { M: "var(--shift-morning)", A: "var(--shift-afternoon)", N: "var(--shift-night)" };

export function RosterExample() {
  return (
    <figure className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm text-[var(--muted)]">
        <span className="font-medium text-[var(--foreground)]">Example roster, one week</span>
        <span>Invented staff, to show the checks</span>
      </figcaption>
      <div className="overflow-x-auto" role="region" aria-label="Roster example" tabIndex={0}>
        <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">An example week of duties with one statutory finding</caption>
          <thead>
            <tr>
              <th scope="col" className="w-28 px-2 py-1 text-left font-medium text-[var(--muted)]">
                Staff
              </th>
              {DAYS.map((d) => (
                <th key={d} scope="col" className="px-1 py-1 text-center font-medium text-[var(--muted)]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name}>
                <th scope="row" className={`border-t border-[var(--border)] px-2 py-1.5 text-left font-normal ${r.finding ? "border-l-[3px] border-l-[var(--status-block)]" : ""}`}>
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-[var(--muted)]">{r.cadre}</span>
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} className="border-t border-[var(--border)] px-1 py-1.5 text-center">
                    {c ? (
                      <span
                        className="inline-flex h-8 w-full min-w-9 items-center justify-center rounded-[4px] text-xs font-semibold text-white"
                        style={{ background: COLOUR[c], outline: r.finding && i >= r.finding.from && i <= r.finding.to ? "2px solid var(--status-block)" : undefined, outlineOffset: 1 }}
                        title={NAME[c]}
                      >
                        {NAME[c].slice(0, 3)}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]" aria-label="Off">
                        –
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 border-l-[3px] border-l-[var(--status-block)] bg-[var(--status-block-soft)] px-3 py-2 text-sm">
        <p className="font-semibold text-[var(--status-block)]">Cannot be published</p>
        <p>Staff B finishes the Monday Night shift at 08:00 on Tuesday and starts Afternoon at 14:00. That is 6 hours between shifts, and the minimum set for this facility is 11. Change one duty, or record an override with a reason.</p>
      </div>
    </figure>
  );
}

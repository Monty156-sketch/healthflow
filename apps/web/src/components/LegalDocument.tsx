import Link from "next/link";
import type { ReactNode } from "react";
import type { Block, LegalDoc } from "@/lib/legal";
import { PublicNav } from "@/components/PublicNav";
import { PrintButton } from "@/components/PrintButton";

/** Turns **bold**, [text](/path) and {{to be confirmed: x}} in a string into elements. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)]*)\)|\{\{(.+?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[2]) out.push(<Link key={i++} href={m[3]} className="text-[var(--accent-text)] underline underline-offset-2">{m[2]}</Link>);
    else out.push(<span key={i++} className="rounded-[3px] border border-dashed border-[var(--border-strong)] px-1 text-[var(--muted)]">{m[4].replace(/^to be confirmed: /, "To be confirmed: ")}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ b }: { b: Block }) {
  if ("p" in b) return <p className="mb-3 leading-relaxed">{inline(b.p)}</p>;
  if ("h" in b) return <h3 className="mb-2 mt-4 text-[15px] font-semibold">{b.h}</h3>;
  if ("ul" in b)
    return (
      <ul className="mb-3 list-disc space-y-1.5 pl-5 leading-relaxed">
        {b.ul.map((x, i) => (
          <li key={i}>{inline(x)}</li>
        ))}
      </ul>
    );
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-[15px]">
        <thead>
          <tr>
            {b.table.head.map((h) => (
              <th key={h} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="border-b border-[var(--border)] px-3 py-2 align-top">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalDocument({ doc, other, print }: { doc: LegalDoc; other: { href: string; label: string }; print?: boolean }) {
  return (
    <>
    <PublicNav />
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
      <h1 className="text-3xl font-semibold leading-tight">{doc.title}</h1>
      <p className="figures mt-2 text-[15px] text-[var(--muted)]">
        Version {doc.version}. Effective {inline(doc.effective)}
      </p>
      {print && (
        <div className="mt-4">
          <PrintButton label="Save as PDF" />
        </div>
      )}
      <div className="mt-5 rounded-[var(--radius)] border border-[var(--border)] border-l-[3px] border-l-[var(--status-warning)] bg-[var(--surface)] px-4 py-3 text-[15px]">
        This is the draft that applies during the pilot. It has not yet been reviewed by a lawyer. Items marked <em>To be confirmed</em> will be filled in
        before it takes effect.
      </div>

      <nav aria-label="Contents" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Contents</h2>
        <ol className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-2">
          {doc.sections.map((s, i) => (
            <li key={s.title}>
              <a href={`#s${i + 1}`} className="inline-flex min-h-8 items-center text-[var(--accent-text)] underline-offset-2 hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8">
        {doc.sections.map((s, i) => (
          <section key={s.title} id={`s${i + 1}`} aria-labelledby={`h${i + 1}`} className="mb-7 scroll-mt-4">
            <h2 id={`h${i + 1}`} className="mb-3 text-xl font-semibold">
              {i + 1}. {s.title}
            </h2>
            {s.blocks.map((b, k) => (
              <BlockView key={k} b={b} />
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
        <Link href={other.href} className="text-[var(--accent-text)] underline-offset-2 hover:underline">
          {other.label}
        </Link>
      </footer>
    </main>
    </>
  );
}

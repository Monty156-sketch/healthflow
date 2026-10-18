"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Block, LegalDoc, Section } from "@/lib/legal";
import { api } from "@/lib/api";
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

interface Stored {
  current: { title: string; version: string; body: string; effectiveDate: string | null; summaryOfChanges: string | null };
  history: { version: string; effectiveDate: string | null; publishedAt: string; summaryOfChanges: string | null }[];
}

/** "## Heading" opens a section, "- " lines are bullets, "### " is a sub-heading, blank lines separate paragraphs. */
function parseBody(body: string): Section[] {
  const sections: Section[] = [];
  let cur: Section = { title: "Summary", blocks: [] };
  let list: string[] | null = null;
  const flush = () => { if (list) { cur.blocks.push({ ul: list }); list = null; } };
  const para: string[] = [];
  const flushPara = () => { if (para.length) { cur.blocks.push({ p: para.join(" ") }); para.length = 0; } };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flushPara(); flush();
      if (cur.blocks.length) sections.push(cur);
      cur = { title: line.slice(3).trim(), blocks: [] };
    } else if (line.startsWith("### ")) { flushPara(); flush(); cur.blocks.push({ h: line.slice(4).trim() }); }
    else if (line.startsWith("- ")) { flushPara(); (list ??= []).push(line.slice(2).trim()); }
    else if (line === "") { flushPara(); flush(); }
    else { flush(); para.push(line); }
  }
  flushPara(); flush();
  if (cur.blocks.length || sections.length === 0) sections.push(cur);
  return sections;
}

export function LegalDocument({ doc: fallback, other, print, slug }: { doc: LegalDoc; other: { href: string; label: string }; print?: boolean; slug?: string }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [loaded, setLoaded] = useState(!slug);
  useEffect(() => {
    if (!slug) return;
    api.get<Stored>(`/api/public/legal/${slug}`).then(setStored).catch(() => setStored(null)).finally(() => setLoaded(true));
  }, [slug]);
  const doc: LegalDoc = stored
    ? { title: stored.current.title, version: stored.current.version, effective: stored.current.effectiveDate ? new Date(stored.current.effectiveDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "", sections: parseBody(stored.current.body) }
    : fallback;
  if (!loaded) return (<><PublicNav /><main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8"><p role="status" className="text-[var(--muted)]">Loading</p></main></>);
  const short = doc.sections.length <= 8;
  return (
    <>
    <PublicNav />
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
      <h1 className="text-3xl font-semibold leading-tight">{doc.title}</h1>
      <p className="figures mt-2 text-[15px] text-[var(--muted)]">
        Version {doc.version} · Effective {inline(doc.effective)}
      </p>
      {print && (
        <div className="mt-4">
          <PrintButton label="Save as PDF" />
        </div>
      )}
      {!stored && <div className="mt-5 rounded-[var(--radius)] border border-[var(--border)] border-l-[3px] border-l-[var(--status-warning)] bg-[var(--surface)] px-4 py-3 text-[15px]">
        This is the draft that applies during the pilot. It has not yet been reviewed by a lawyer. Items marked <em>To be confirmed</em> will be filled in
        before it takes effect.
      </div>}

      {!short && <nav aria-label="Contents" className="mt-6">
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
      </nav>}

      <div className="mt-8">
        {doc.sections.map((s, i) => (
          <section key={s.title} id={`s${i + 1}`} aria-labelledby={`h${i + 1}`} className="mb-7 scroll-mt-4">
            <h2 id={`h${i + 1}`} className="mb-3 text-xl font-semibold">
              {short ? "" : `${i + 1}. `}{s.title}
            </h2>
            {s.blocks.map((b, k) => (
              <BlockView key={k} b={b} />
            ))}
          </section>
        ))}
      </div>

      {stored && stored.history.length > 1 && (
        <section aria-labelledby="history" className="mt-8">
          <h2 id="history" className="mb-2 text-xl font-semibold">Earlier versions</h2>
          <ul className="space-y-1 text-[15px]">
            {stored.history.map((h) => (
              <li key={h.version}>Version {h.version}{h.effectiveDate ? `, effective ${new Date(h.effectiveDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.{h.summaryOfChanges ? ` ${h.summaryOfChanges}` : ""}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
        <Link href={other.href} className="text-[var(--accent-text)] underline-offset-2 hover:underline">
          {other.label}
        </Link>
      </footer>
    </main>
    </>
  );
}

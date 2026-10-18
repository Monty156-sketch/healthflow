"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sectionFor } from "@/lib/sections";

/** The pages of one section, as tabs above the page. Shows only the pages this role may open, and nothing when there is only one. */
export function SectionTabs({ role }: { role: string }) {
  const pathname = usePathname();
  const hit = sectionFor(pathname);
  if (!hit) return null;
  const tabs = hit.section.tabs.filter((t) => t.roles.includes(role));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="In this section" className="no-print mb-5 overflow-x-auto border-b border-[var(--border)]">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const current = t.href === hit.current;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] ${
                  current ? "border-[var(--accent)] font-medium text-[var(--accent-text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

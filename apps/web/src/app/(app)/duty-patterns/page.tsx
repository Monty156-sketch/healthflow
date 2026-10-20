"use client";

import { useState } from "react";
import { EmbeddedPage, PageHeader } from "@/components/ui";
import { RotationPanel } from "@/components/RotationPanel";
import ShiftsPage from "../shifts/page";
import DutyCyclesPage from "../duty-cycles/page";
import RulesPage from "../rules/page";

const TABS = [
  { id: "shifts", label: "Shifts", summary: "The duties people work: when they start and end, how long they are, and how many people each needs." },
  { id: "cycles", label: "Duty cycles", summary: "How many duties in a row, how many days off after them, and which shift staff come back on after a rest." },
  { id: "rotation", label: "Rotation order", summary: "The order shifts follow one another after a rest." },
  { id: "limits", label: "Limits", summary: "The checks every roster is held against. Statutory limits are marked and cannot be changed." },
] as const;
type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  if (typeof window === "undefined") return "shifts";
  const hash = window.location.hash.replace("#", "");
  return TABS.find((t) => t.id === hash)?.id ?? "shifts";
}

export default function DutyPatternsPage() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const current = TABS.find((t) => t.id === tab)!;

  function choose(id: TabId) {
    setTab(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* the address bar is a convenience only */
    }
  }

  return (
    <>
      <PageHeader title="Duty patterns" description="Set these up in order. The roster is built from them." />
      <div role="tablist" aria-label="Duty patterns" className="mb-2 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="pattern-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => choose(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") choose(TABS[(i + 1) % TABS.length].id);
              if (e.key === "ArrowLeft") choose(TABS[(i + TABS.length - 1) % TABS.length].id);
            }}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              tab === t.id ? "bg-[var(--accent)] text-white" : "border border-[var(--border-strong)] hover:bg-[var(--accent-soft)]"
            }`}
          >
            <span className="figures mr-1.5 opacity-70">{i + 1}</span>
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-5 text-sm text-[var(--muted)]">{current.summary}</p>
      <div role="tabpanel" id="pattern-panel" aria-labelledby={`tab-${tab}`}>
        <EmbeddedPage.Provider value={true}>
          {tab === "shifts" && <ShiftsPage />}
          {tab === "cycles" && <DutyCyclesPage />}
          {tab === "rotation" && <RotationPanel />}
          {tab === "limits" && <RulesPage />}
        </EmbeddedPage.Provider>
      </div>
    </>
  );
}

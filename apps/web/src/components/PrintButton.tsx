"use client";

import { Button } from "@/components/ui";

/** Opens the print dialog, where "Save as PDF" is a choice. The page has a print layout. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" className="no-print" onClick={() => window.print()}>
      {label}
    </Button>
  );
}

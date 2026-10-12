"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { reportAutomatically } from "@/components/ReportProblem";
import { Button, Notice } from "@/components/ui";

/** Shown when a screen crashes while drawing. The error is reported for PS Tech to look at. */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    void reportAutomatically(pathname, error.message || "A screen failed to draw", { digest: error.digest });
  }, [error, pathname]);
  return (
    <div className="max-w-xl">
      <Notice tone="block" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
        This screen had a problem and could not be shown. It has been reported. Nothing you saved has been lost.
      </Notice>
    </div>
  );
}

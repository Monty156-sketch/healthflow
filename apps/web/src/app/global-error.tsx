"use client";

/** The last resort, when even the page frame fails to draw. It has to stand alone: no providers, no shared components. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#eef2ef", color: "#10242a" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 20px" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6 }}>HealthFlow could not draw this page. Nothing you saved has been lost. Try again, and if it keeps happening call 055 457 1800.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", fontSize: 16, background: "#0b6560", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

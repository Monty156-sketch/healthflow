"use client";

// Error capture (Part 3, 0.7): people can report a problem in their own
// words, and unexpected browser errors are sent automatically with the
// screen they happened on. Neither ever includes what was typed in a form.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button, ConfirmDialog, Field, Notice, Textarea } from "@/components/ui";

const sentThisPage = new Set<string>();

/** Sends an unexpected error. Silent on failure, capped, and never repeats the same message. */
export async function reportAutomatically(screen: string, message: string, extra?: Record<string, unknown>) {
  const key = `${screen}|${message}`;
  if (sentThisPage.has(key) || sentThisPage.size >= 5) return;
  sentThisPage.add(key);
  try {
    await api.post("/api/errors", {
      kind: "automatic",
      screen,
      description: message.slice(0, 500),
      context: { userAgent: navigator.userAgent, ...extra },
    });
  } catch {
    // Reporting must never cause a second problem.
  }
}

/** Mounted once in the signed-in shell. */
export function ErrorCapture() {
  const pathname = usePathname();
  const { user } = useAuth();
  const screen = useRef(pathname);
  useEffect(() => {
    screen.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!user) return;
    const onError = (e: ErrorEvent) => {
      // Script-load noise from extensions has no message or file we can use.
      if (!e.message || e.message === "Script error.") return;
      void reportAutomatically(screen.current, e.message, { source: e.filename, line: e.lineno });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // Failed requests are already shown to the person on the screen that made them.
      if (e.reason instanceof ApiError) return;
      const msg = e.reason instanceof Error ? e.reason.message : "Unhandled promise rejection";
      if (/failed to fetch|networkerror|load failed/i.test(msg)) return;
      void reportAutomatically(screen.current, msg);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [user]);

  return null;
}

export function ReportProblem() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/api/errors", {
        kind: "report",
        screen: pathname,
        description: text,
        context: { userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}` },
      });
      setText("");
      setOpen(false);
      setSent(true);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { fields?: { description?: string }; message?: string }) : undefined;
      setError(body?.fields?.description ?? body?.message ?? "The report could not be sent. Your text is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="quiet"
        className="-ml-3"
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
      >
        Report a problem
      </Button>
      {sent && (
        <div className="mt-1">
          <Notice tone="success">Thank you. Your report was sent to PS Tech.</Notice>
        </div>
      )}
      <ConfirmDialog open={open} title="Report a problem" confirmLabel="Send report" busy={busy} onConfirm={send} onCancel={() => setOpen(false)}>
        <Field
          label="What were you doing, and what went wrong?"
          hint="The screen you are on and your device type are sent with this. Do not include patient details."
          error={error}
        >
          {(a) => <Textarea {...a} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </>
  );
}

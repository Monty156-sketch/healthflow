"use client";

// Asking how HealthFlow is working for people. A short box appears now and then (the server decides
// when, see /api/facility/feedback/prompt) and a "Give feedback" button is always in the menu.
// Everything goes to PS Tech and is read in the platform console.
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Checkbox, Field, Notice, Select, Textarea } from "@/components/ui";

const RATINGS = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Good" },
  { value: 4, label: "Very good" },
  { value: 5, label: "Excellent" },
];

const CATEGORIES = [
  { value: "GENERAL", label: "General comment" },
  { value: "IDEA", label: "An idea to improve it" },
  { value: "PROBLEM", label: "Something is not working well" },
  { value: "PRAISE", label: "Something that works well" },
];

function FeedbackDialog({ open, asked, onClose, onLater, onSent }: { open: boolean; asked: boolean; onClose: () => void; onLater?: () => void; onSent: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pathname = usePathname();
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState("GENERAL");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [canConfirm, setCanConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function send() {
    if (rating === null) return setError("Choose a rating from 1 to 5.");
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/api/facility/feedback", { rating, category, message, screen: pathname, asked, confirmNoPatientDetails: confirmed });
      setRating(null);
      setMessage("");
      setCategory("GENERAL");
      setConfirmed(false);
      setCanConfirm(false);
      onSent();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { fields?: { message?: string; rating?: string }; message?: string; canConfirm?: boolean }) : undefined;
      setCanConfirm(Boolean(body?.canConfirm));
      setError(body?.fields?.message ?? body?.fields?.rating ?? body?.message ?? "Your feedback could not be sent. Your text is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  const dismiss = onLater ?? onClose;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      className="m-auto w-[min(92vw,32rem)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          How is HealthFlow working for you?
        </h2>
        <p className="mt-1 text-[15px] text-[var(--muted)]">Your answer goes to PS Tech and helps us decide what to improve next. It takes under a minute.</p>

        <fieldset className="mt-4">
          <legend className="text-[15px] font-medium">Your rating</legend>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {RATINGS.map((r) => (
              <label
                key={r.value}
                className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-[var(--radius)] border px-1 text-center text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] ${
                  rating === r.value ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold" : "border-[var(--border)]"
                }`}
              >
                <input type="radio" name="feedback-rating" value={r.value} checked={rating === r.value} onChange={() => setRating(r.value)} className="sr-only" />
                <span className="figures text-base">{r.value}</span>
                <span className="text-[12px] text-[var(--muted)]">{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 space-y-4">
          <Field label="What is it about?">
            {(a) => (
              <Select {...a} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Your comment" optional hint="Do not include patient details." error={error}>
            {(a) => <Textarea {...a} rows={4} maxLength={2000} value={message} onChange={(e) => { setMessage(e.target.value); setConfirmed(false); }} />}
          </Field>
          {canConfirm && (
            <Checkbox label="This is not about a patient. These are not patient details." checked={confirmed} onChange={setConfirmed} />
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={dismiss} disabled={busy}>
            {onLater ? "Not now" : "Cancel"}
          </Button>
          <Button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send feedback"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Mounted once in the signed-in facility shell. Asks when the server says it is time, a few seconds after the page opens. */
export function FeedbackPrompt() {
  const [due, setDue] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ due: boolean }>("/api/facility/feedback/prompt");
        if (live && r.due) setDue(true);
      } catch {
        // Asking for feedback must never get in the way.
      }
    }, 8000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  async function later() {
    setDue(false);
    await api.post("/api/facility/feedback/later", {}).catch(() => undefined);
  }

  return <FeedbackDialog open={due} asked onClose={later} onLater={later} onSent={() => setDue(false)} />;
}

/** The always-available button. */
export function GiveFeedback() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
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
        Give feedback
      </Button>
      {sent && (
        <div className="mt-1">
          <Notice tone="success">Thank you. PS Tech has your feedback.</Notice>
        </div>
      )}
      <FeedbackDialog
        open={open}
        asked={false}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false);
          setSent(true);
        }}
      />
    </>
  );
}

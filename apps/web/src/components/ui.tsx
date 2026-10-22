// Shared building blocks, so every screen follows the same rules without
// each page re-deciding them: 44px touch targets, a label on every field,
// errors written next to their field, colour never the only signal.
"use client";

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Link from "next/link";

// ------------------------------------------------------------- buttons

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-110 active:brightness-95",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--accent-soft)]",
  quiet: "text-[var(--accent-text)] hover:bg-[var(--accent-soft)]",
  danger:
    "border border-[var(--status-block)] bg-[var(--surface)] text-[var(--status-block)] hover:bg-[var(--status-block-soft)]",
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------- form fields

const CONTROL =
  "w-full min-h-11 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--foreground)] outline-none focus-visible:border-[var(--accent)] aria-[invalid=true]:border-[var(--status-block)]";

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="mb-1 block text-sm font-medium" {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  if (props.type !== "password") return <input className={`${CONTROL} ${className}`} {...props} />;
  // Every password box gets an eye to show or hide what was typed.
  return (
    <div className="relative">
      <input className={`${CONTROL} pr-12 ${className}`} {...props} type={shown ? "text" : "password"} />
      <button
        type="button"
        onClick={() => setShown((x) => !x)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {shown ? (
            <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-3 3.8M6.5 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 3.4-.6" /><path d="M9.9 10a3 3 0 0 0 4.1 4.1" /></>
          ) : (
            <><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6S3.5 14 2.5 12z" /><circle cx="12" cy="12" r="3" /></>
          )}
        </svg>
      </button>
    </div>
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} min-h-20 py-2 ${className}`} {...props} />;
}

/**
 * A labelled field with its hint and error wired up for screen readers.
 * The child receives the id/aria props through the render function.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-[var(--muted)]"> (optional)</span>}
      </Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-[var(--muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-[var(--status-block)]">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-sm text-[var(--muted)]">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- feedback

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--status-block)]">{children}</p>;
}

/** A message with a left stripe, the app's one status device. */
export function Notice({
  tone = "neutral",
  children,
  action,
}: {
  tone?: "neutral" | "block" | "warning" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const stripe = {
    neutral: "var(--accent)",
    block: "var(--status-block)",
    warning: "var(--status-warning)",
    success: "var(--status-success)",
  }[tone];
  return (
    <div
      role={tone === "block" ? "alert" : "status"}
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] py-3 pr-3 pl-4 text-sm"
      style={{ boxShadow: `inset 3px 0 0 ${stripe}` }}
    >
      <div>{children}</div>
      {action}
    </div>
  );
}

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** Every save shows saving, saved, or failed with a retry (standing instructions). */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state === "idle") return <span aria-live="polite" />;
  return (
    <span aria-live="polite" className="inline-flex items-center gap-2 text-sm">
      {state === "saving" && <span className="text-[var(--muted)]">Saving…</span>}
      {state === "saved" && <span className="text-[var(--status-success)]">Saved</span>}
      {state === "failed" && (
        <>
          <span className="text-[var(--status-block)]">Not saved.</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="min-h-11 font-medium text-[var(--accent-text)] underline">
              Try again
            </button>
          )}
        </>
      )}
    </span>
  );
}

// ------------------------------------------------------------- status

export type StatusTone = "success" | "warning" | "block" | "neutral";

/** A status as a word with a coloured edge: never colour alone. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const color = {
    success: "var(--status-success)",
    warning: "var(--status-warning)",
    block: "var(--status-block)",
    neutral: "var(--status-neutral)",
  }[tone];
  return (
    <span
      className="inline-flex items-center rounded-[4px] border border-[var(--border)] bg-[var(--surface)] py-0.5 pr-2 pl-2.5 text-[13px] font-medium whitespace-nowrap"
      style={{ boxShadow: `inset 3px 0 0 ${color}`, color }}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------- layout

/** A page shown inside another page's tab keeps its description and actions, and drops its own title. */
export const EmbeddedPage = createContext(false);

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const embedded = useContext(EmbeddedPage);
  if (embedded) {
    if (!description && !actions) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {description && <p className="max-w-[65ch] text-[var(--muted)]">{description}</p>}
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    );
  }
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[65ch]">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 text-[var(--muted)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-t-[var(--radius)] border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="text-sm text-[var(--muted)]">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Wide tables scroll inside their own box; the page never scrolls sideways. */
export function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="relative overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export const TH = "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left text-[13px] font-semibold text-[var(--muted)] whitespace-nowrap";
export const TD = "border-b border-[var(--border)] px-3 py-3 align-top";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] px-5 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[50ch] text-sm text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-sm text-[var(--muted)]">
      {label}…
    </p>
  );
}

/** A load failure always offers a next step. */
export function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Notice tone="block" action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>
      {message ?? "This could not be loaded. Check your connection and try again."}
    </Notice>
  );
}

// ------------------------------------------------------------- dialog

/** A confirmation built on <dialog>: focus is trapped and Escape closes it. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-black/40"
      aria-labelledby={titleId}
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-[15px]">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** A plain bordered box (the sign-in form). */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 ${className}`}>
      {children}
    </div>
  );
}

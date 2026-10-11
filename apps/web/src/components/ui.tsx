// Small shared primitives so every screen uses the same button, input and
// card shapes rather than each page inventing its own. Deliberately plain:
// small corner radius, a border instead of a shadow, no gradients.
import { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const base =
    "inline-flex items-center justify-center rounded-[var(--radius)] px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-[var(--accent)] text-white hover:opacity-90",
    secondary:
      "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--border)]/30",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="block text-sm font-medium mb-1" {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius)] border border-[var(--border)] p-6 ${className}`}>
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm" style={{ color: "var(--status-block)" }}>
      {children}
    </p>
  );
}

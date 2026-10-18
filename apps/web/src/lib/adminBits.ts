import { ApiError } from "@/lib/api";

export type Say = { tone: "success" | "block"; text: string } | null;

export function failure(e: unknown, fallback = "That did not work. Try again."): string {
  const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
  return b?.message ?? (b?.fields ? Object.values(b.fields)[0] : fallback);
}

import type { RosterSummary } from "@/lib/types";

export const STATUS_WORD: Record<RosterSummary["status"], string> = {
  DRAFT: "Draft",
  GENERATED: "Generated",
  UNDER_REVIEW: "With the nursing manager",
  WITH_ADMINISTRATOR: "With the administrator",
  WITH_SUPERINTENDENT: "With the medical superintendent",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export function statusTone(s: RosterSummary["status"]) {
  return s === "PUBLISHED" || s === "APPROVED" ? "success" : s === "DRAFT" ? "neutral" : "warning";
}

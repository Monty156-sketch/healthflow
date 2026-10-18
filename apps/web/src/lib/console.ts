export const REQUEST_STATUS: Record<string, string> = {
  NEW: "New", CONTACTED: "Contacted", DEMO_SCHEDULED: "Demo scheduled", AGREEMENT_SENT: "Agreement sent", PROVISIONED: "Provisioned", DECLINED: "Declined", DORMANT: "Dormant",
};
export const HEALTH_WORD: Record<string, string> = { HEALTHY: "Healthy", WATCH: "Watch", AT_RISK: "At risk" };
export const HEALTH_TONE: Record<string, "success" | "warning" | "block"> = { HEALTHY: "success", WATCH: "warning", AT_RISK: "block" };
export const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;

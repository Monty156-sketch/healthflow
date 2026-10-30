// Every piece of feedback is also emailed to the owners, whatever the rating, so none is missed.
// Fire and forget: a failed email never stops the feedback being saved.
import { appUrl, sendEmail } from "./email.js";

const owners = () => (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

const TOPIC: Record<string, string> = { GENERAL: "General comment", IDEA: "Idea", PROBLEM: "Problem", PRAISE: "Praise" };

export function emailFeedback(f: { rating: number; category: string; message: string | null; facility: string; from: string; role: string; screen: string | null }) {
  const text = [
    `${f.rating} out of 5, ${TOPIC[f.category] ?? f.category}`,
    "",
    f.message ?? "(no comment)",
    "",
    `From: ${f.from} (${f.role.replace(/_/g, " ").toLowerCase()}), ${f.facility}`,
    f.screen ? `Screen: ${f.screen}` : "",
    "",
    `Read and sort all feedback: ${appUrl("/platform/feedback")}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  for (const to of owners()) void sendEmail({ to, subject: `HealthFlow feedback: ${f.rating} out of 5 from ${f.facility}`, text }).catch(() => undefined);
}

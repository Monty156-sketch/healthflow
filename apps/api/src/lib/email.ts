// Sending email. Two providers work, and the first one that is fully set wins:
//   1. Gmail (free, no domain needed): the API sends as a Gmail account you own,
//      through Google's web API. Needs GMAIL_USER, GMAIL_CLIENT_ID,
//      GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN. See RUNBOOK.md, "Email".
//   2. Resend (needs a domain you own): RESEND_API_KEY and EMAIL_FROM.
// When neither is set, nothing is sent and the caller is told so; flows that
// depend on email have a non-email path (for password reset: a facility admin
// issues the link).

import { prisma } from "./prisma.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

const gmailConfigured = () => Boolean(process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
const resendConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export function emailConfigured(): boolean {
  return gmailConfigured() || resendConfigured();
}

/** Which provider will send, for the start-up log and the runbook. */
export function emailProviderName(): "Gmail" | "Resend" | null {
  return gmailConfigured() ? "Gmail" : resendConfigured() ? "Resend" : null;
}

let cachedToken: { value: string; expires: number } | null = null;

/** For tests: drop the remembered Google token. */
export const forgetEmailToken = () => { cachedToken = null; };

async function gmailAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      refresh_token: process.env.GMAIL_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google refused the sign-in (${body.error ?? res.status}). Make a new refresh token.`);
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** A plain-text message in the form Gmail's API takes: RFC 5322 text, base64url encoded. */
export function gmailRaw(message: Email, from: string): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const lines = [
    `From: ${from}`,
    `To: ${clean(message.to)}`,
    `Subject: =?UTF-8?B?${b64(clean(message.subject))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    (b64(message.text).match(/.{1,76}/g) ?? []).join("\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function sendViaGmail(message: Email): Promise<boolean> {
  const token = await gmailAccessToken();
  const user = process.env.GMAIL_USER ?? "";
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: gmailRaw(message, `HealthFlow <${user}>`) }),
  });
  if (res.status === 401) cachedToken = null;
  if (!res.ok) {
    console.error(`Gmail refused the message with ${res.status}: "${message.subject}"`);
    return false;
  }
  return true;
}

async function sendViaResend(message: Email): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });
  if (!res.ok) {
    console.error(`Email to provider failed with ${res.status}: "${message.subject}"`);
    return false;
  }
  return true;
}

/** Notes the outcome for System health. Never throws and never holds an address or text. */
async function noteOutcome(outcome: "SENT" | "FAILED" | "NOT_CONFIGURED", error?: string) {
  try {
    await prisma.emailEvent.create({ data: { outcome, error: error?.slice(0, 200) ?? null } });
  } catch {
    // Keeping count must never stop an email.
  }
}

export async function sendEmail(message: Email): Promise<boolean> {
  if (!emailConfigured()) {
    console.warn(`Email not sent (no email provider is set): "${message.subject}"`);
    await noteOutcome("NOT_CONFIGURED");
    return false;
  }
  try {
    const ok = gmailConfigured() ? await sendViaGmail(message) : await sendViaResend(message);
    await noteOutcome(ok ? "SENT" : "FAILED", ok ? undefined : "The provider refused the message");
    return ok;
  } catch (err) {
    console.error("Email could not be sent:", (err as Error).message);
    await noteOutcome("FAILED", (err as Error).message);
    return false;
  }
}

/** Where links in emails and admin-issued links point. */
export function appUrl(path: string): string {
  const origin = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}${path}`;
}

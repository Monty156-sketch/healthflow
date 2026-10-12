// Sending email through Resend (https://resend.com), the provider named in
// the deployment plan. When RESEND_API_KEY is not set, nothing is sent and
// the caller is told so; flows that depend on email have a non-email path
// (for password reset: a facility admin issues the link).

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(message: Email): Promise<boolean> {
  if (!emailConfigured()) {
    console.warn(`Email not sent (RESEND_API_KEY or EMAIL_FROM not set): "${message.subject}"`);
    return false;
  }
  try {
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
  } catch (err) {
    console.error("Email could not be sent:", (err as Error).message);
    return false;
  }
}

/** Where links in emails and admin-issued links point. */
export function appUrl(path: string): string {
  const origin = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}${path}`;
}

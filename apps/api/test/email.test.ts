import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfigured, emailProviderName, forgetEmailToken, gmailRaw, sendEmail } from "../src/lib/email.js";

const KEYS = ["GMAIL_USER", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "RESEND_API_KEY", "EMAIL_FROM"];
const saved: Record<string, string | undefined> = {};
const gmailEnv = { GMAIL_USER: "ps@gmail.com", GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "refresh" };
const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

beforeEach(() => { forgetEmailToken(); for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.unstubAllGlobals(); });

describe("email providers", () => {
  it("is not configured with nothing set, and sends nothing", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(emailConfigured()).toBe(false);
    expect(await sendEmail({ to: "a@b.com", subject: "s", text: "t" })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("prefers Gmail when it is fully set, even if Resend is also set", () => {
    Object.assign(process.env, gmailEnv, { RESEND_API_KEY: "k", EMAIL_FROM: "x@y.com" });
    expect(emailProviderName()).toBe("Gmail");
  });

  it("falls back to Resend, and ignores a half-set Gmail", () => {
    Object.assign(process.env, { GMAIL_USER: "ps@gmail.com", RESEND_API_KEY: "k", EMAIL_FROM: "x@y.com" });
    expect(emailProviderName()).toBe("Resend");
  });

  it("sends through Gmail: gets a token, then posts the encoded message", async () => {
    Object.assign(process.env, gmailEnv);
    const f = vi.fn(async (url: string) => (url.includes("oauth2") ? Response.json({ access_token: "tok", expires_in: 3600 }) : Response.json({ id: "m1" })));
    vi.stubGlobal("fetch", f);
    expect(await sendEmail({ to: "staff@example.com", subject: "Reset your password", text: "Open the link.\nThanks" })).toBe(true);
    const [, send] = f.mock.calls as unknown as [unknown, [string, { headers: Record<string, string>; body: string }]];
    expect(send[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(send[1].headers.Authorization).toBe("Bearer tok");
    const mime = decode(JSON.parse(send[1].body).raw);
    expect(mime).toContain("From: HealthFlow <ps@gmail.com>");
    expect(mime).toContain("To: staff@example.com");
  });

  it("reports failure instead of throwing when Google refuses", async () => {
    Object.assign(process.env, { ...gmailEnv, GMAIL_REFRESH_TOKEN: "bad" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    expect(await sendEmail({ to: "a@b.com", subject: "s", text: "t" })).toBe(false);
  });
});

describe("gmailRaw", () => {
  it("encodes non-ASCII subjects and bodies, and cannot be given extra headers", () => {
    const mime = decode(gmailRaw({ to: "a@b.com\r\nBcc: evil@x.com", subject: "Duty roster – week 3\r\nBcc: evil@x.com", text: "Medaase, Akɔ yɛ" }, "HealthFlow <ps@gmail.com>"));
    const [head, body] = mime.split("\r\n\r\n");
    expect(head.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toHaveLength(0);
    expect(head).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Medaase, Akɔ yɛ");
  });
});

import { describe, expect, it } from "vitest";
import { checkEnvironment } from "../src/lib/env.js";

const good = { DATABASE_URL: "postgres://x", JWT_ACCESS_SECRET: "a".repeat(40), JWT_REFRESH_PEPPER: "b".repeat(40), MFA_ENCRYPTION_KEY: "k", WEB_ORIGIN: "https://app.example.com" } as NodeJS.ProcessEnv;

describe("start-up configuration check", () => {
  it("passes a complete configuration", () => expect(checkEnvironment(good)).toEqual({ missing: [], warnings: [] }));
  it("names every missing setting", () => {
    const p = checkEnvironment({} as NodeJS.ProcessEnv).missing;
    expect(p).toHaveLength(5);
    expect(p.join(" ")).toContain("MFA_ENCRYPTION_KEY");
  });
  it("refuses short secrets, an http origin, a trailing slash and half-set email", () => {
    expect(checkEnvironment({ ...good, JWT_ACCESS_SECRET: "short" } as NodeJS.ProcessEnv).warnings).toHaveLength(1);
    expect(checkEnvironment({ ...good, WEB_ORIGIN: "http://x.com" } as NodeJS.ProcessEnv).warnings).toHaveLength(1);
    expect(checkEnvironment({ ...good, WEB_ORIGIN: "https://x.com/" } as NodeJS.ProcessEnv).warnings).toHaveLength(1);
    expect(checkEnvironment({ ...good, RESEND_API_KEY: "k" } as NodeJS.ProcessEnv).warnings).toHaveLength(1);
  });
  it("warns when Gmail email is only partly set, and accepts it complete", () => {
    expect(checkEnvironment({ ...good, GMAIL_USER: "a@gmail.com" } as NodeJS.ProcessEnv).warnings).toHaveLength(1);
    const all = { ...good, GMAIL_USER: "a@gmail.com", GMAIL_CLIENT_ID: "i", GMAIL_CLIENT_SECRET: "s", GMAIL_REFRESH_TOKEN: "r" } as NodeJS.ProcessEnv;
    expect(checkEnvironment(all).warnings).toEqual([]);
  });
});

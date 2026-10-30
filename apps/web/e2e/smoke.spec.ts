import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/pricing", "/security", "/terms", "/privacy", "/login", "/district/login", "/platform/login", "/district/register", "/region/register", "/supervisors", "/join", "/register", "/help"];

/** Collects what the browser complains about while a page loads. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text().slice(0, 200));
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  return problems;
}

test.describe("public pages", () => {
  for (const path of PAGES) {
    test(`${path} loads, hydrates and breaks no policy`, async ({ page }) => {
      const problems = watch(page);
      const res = await page.goto(path, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }

  test("an unknown address shows the not-found page with a real 404", async ({ page }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});

test.describe("security headers", () => {
  test("the strict style policy breaks nothing on the public pages", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
    page.on("pageerror", (e) => violations.push(e.message));
    for (const path of ["/", "/login", "/pricing", "/register"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });

  test("pages carry a script policy whose nonce is the one on their scripts", async ({ request }) => {
    const res = await request.get("/login");
    const csp = res.headers()["content-security-policy"];
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  });

  test("each view gets a different nonce", async ({ request }) => {
    const a = (await request.get("/login")).headers()["content-security-policy"];
    const b = (await request.get("/login")).headers()["content-security-policy"];
    expect(a).not.toEqual(b);
  });

  test("the other protective headers are present", async ({ request }) => {
    const h = (await request.get("/")).headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age");
    expect(h["referrer-policy"]).toBeTruthy();
  });
});

test.describe("the three sign-in doors", () => {
  test("each has its own page and wording", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email or phone number")).toBeVisible();
    await expect(page.getByRole("link", { name: /Join with your facility code/ })).toBeVisible();
    await page.goto("/district/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("link", { name: /Register as a supervisor/ })).toBeVisible();
    await page.goto("/platform/login");
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("the supervisors page offers the three ways in", async ({ page }) => {
    await page.goto("/supervisors");
    await expect(page.getByRole("heading", { name: "Regional office" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "District office" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Individual" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Register a hospital" })).toHaveAttribute("href", "/register");
  });

  test("a wrong password gives the same plain answer", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or phone number").fill("nobody@example.test");
    await page.getByLabel("Password").fill("not the password at all");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });
});

test.describe("joining with a facility code", () => {
  test("a code that does not exist is turned away without saying more", async ({ page }) => {
    await page.goto("/join");
    await page.getByLabel("Facility code").fill("NOPE-0000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That code is not valid.")).toBeVisible();
  });
});

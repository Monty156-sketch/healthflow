import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/db-guard.mjs", import.meta.url));
function run(purpose: string, url: string, role = "") {
  try {
    execFileSync(process.execPath, [script, purpose], { env: { PATH: process.env.PATH, DATABASE_URL: url, HEALTHFLOW_DB_ROLE: role }, stdio: "pipe", cwd: "/" });
    return true;
  } catch {
    return false;
  }
}

describe("the database guard", () => {
  it("lets tests run on this computer and on test databases", () => {
    expect(run("test", "postgresql://ci:ci@localhost:5432/healthflow_test")).toBe(true);
    expect(run("test", "postgresql://u:p@ep-x.neon.tech/healthflow_test_copy")).toBe(true);
  });
  it("stops tests on a hosted database that is not a test one", () => {
    expect(run("test", "postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require")).toBe(false);
    expect(run("test", "")).toBe(false);
  });
  it("stops development commands on a hosted database unless it is marked staging", () => {
    const hosted = "postgresql://u:p@ep-x.neon.tech/neondb";
    expect(run("develop", hosted)).toBe(false);
    expect(run("develop", hosted, "staging")).toBe(true);
    expect(run("develop", "postgresql://localhost/healthflow")).toBe(true);
  });
});

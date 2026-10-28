import { beforeEach, describe, expect, it } from "vitest";
import { BURST_THRESHOLD, noteSignInFailure, resetSecurityAlerts } from "../src/lib/securityAlerts.js";

beforeEach(resetSecurityAlerts);

describe("failed sign-in watch", () => {
  it("counts only failures inside the ten minute window", () => {
    const t0 = Date.UTC(2026, 9, 28, 12, 0, 0);
    for (let i = 0; i < BURST_THRESHOLD - 1; i++) expect(noteSignInFailure(t0 + i * 1000)).toBe(false);
    expect(noteSignInFailure(t0 + 20_000)).toBe(true);
    // Eleven minutes later the old ones have aged out.
    expect(noteSignInFailure(t0 + 11 * 60_000)).toBe(false);
  });
});

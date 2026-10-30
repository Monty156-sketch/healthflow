import { beforeEach, describe, expect, it } from "vitest";
import { BURST_THRESHOLD, noteSignInFailure } from "../src/lib/securityAlerts.js";
import { prisma, resetDatabase } from "./helpers.js";

beforeEach(resetDatabase);

describe("failed sign-in watch", () => {
  it("counts only failures inside the ten minute window, from the database", async () => {
    const t0 = Date.UTC(2026, 9, 28, 12, 0, 0);
    for (let i = 0; i < BURST_THRESHOLD - 1; i++) expect(await noteSignInFailure(t0 + i * 1000)).toBe(false);
    expect(await noteSignInFailure(t0 + 20_000)).toBe(true);
    // Eleven minutes later the old ones have aged out.
    expect(await noteSignInFailure(t0 + 11 * 60_000)).toBe(false);
    expect(await prisma.securityEvent.count({ where: { kind: "failed_signin" } })).toBe(BURST_THRESHOLD + 1);
  });
});

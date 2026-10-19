import { describe, expect, it } from "vitest";
import { normalisePhone } from "../src/lib/sms.js";

describe("phone numbers", () => {
  it("accepts Ghana mobile numbers written the usual ways", () => {
    expect(normalisePhone("024 618 7422")).toBe("233246187422");
    expect(normalisePhone("0246187422")).toBe("233246187422");
    expect(normalisePhone("+233 24 618 7422")).toBe("233246187422");
    expect(normalisePhone("233246187422")).toBe("233246187422");
    expect(normalisePhone("(024) 618-7422")).toBe("233246187422");
  });
  it("refuses what cannot be a mobile number", () => {
    for (const bad of ["", null, undefined, "12345", "024 618 742", "+44 7700 900123", "abc"]) expect(normalisePhone(bad as string)).toBeNull();
  });
});


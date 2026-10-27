import { describe, expect, it } from "vitest";
import { directoryFacilities, FACILITY_DIRECTORY, GHANA_DISTRICTS, GHANA_REGION_NAMES } from "@healthflow/shared/geography";

describe("Ghana geography", () => {
  it("has 16 regions and 261 districts", () => {
    expect(GHANA_REGION_NAMES).toHaveLength(16);
    expect(Object.values(GHANA_DISTRICTS).flat()).toHaveLength(261);
  });

  it("only lists directory facilities under real districts of that region", () => {
    for (const [region, districts] of Object.entries(FACILITY_DIRECTORY)) {
      for (const d of Object.keys(districts)) expect(GHANA_DISTRICTS[region]).toContain(d);
    }
  });

  it("holds the 562 Upper West facilities the Ghana Health Service lists", () => {
    const n = Object.values(FACILITY_DIRECTORY["Upper West"]).reduce((a, t) => a + t.C.length + t.H.length + t.P.length, 0);
    expect(n).toBe(562);
    expect(directoryFacilities("Upper West", "Nadowli Kaleo District", "HEALTH_CENTRE")).toContain("Sombo Health Centre");
  });

  it("has no list for a type or region it does not cover", () => {
    expect(directoryFacilities("Upper West", "Wa Metropolitan", "HOSPITAL")).toEqual([]);
    expect(directoryFacilities("Ashanti", "Kumasi Metropolitan", "HEALTH_CENTRE")).toEqual([]);
  });
});

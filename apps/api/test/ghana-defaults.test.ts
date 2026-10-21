import { portfolioFor } from "../src/lib/facilitySetup.js";
import { describe, expect, it } from "vitest";
import { cadreDefaults, leadsByGrade, starterMinimums } from "../src/lib/dutyPlan.js";

describe("Ghana Health Service cadre defaults", () => {
  it("puts nurses and midwives on shifts with nights", () => {
    for (const n of ["Nurse", "Midwife", "Enrolled Nurse", "Community Health Nurse", "Health Assistant"]) {
      expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: false, takesNights: true });
    }
  });
  it("puts pharmacy, laboratory, imaging, records and physician assistants on office hours", () => {
    for (const n of ["Pharmacist", "Pharmacy Technician", "Laboratory Scientist", "Laboratory Technician", "Radiographer", "Health Information Officer", "Disease Control Officer", "Physician Assistant"]) {
      expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: true, takesNights: false });
    }
  });
  it("keeps doctors, accountants and administrators off the duty roster", () => {
    for (const n of ["Medical Officer", "Specialist", "Accountant", "Administrator"]) expect(cadreDefaults(n).onRoster).toBe(false);
  });
  it("gives security, drivers and orderlies nights", () => {
    for (const n of ["Security", "Driver", "Orderly"]) expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: false, takesNights: true });
  });
  it("lets senior grades lead a shift", () => {
    expect(["Senior Staff Nurse", "Ward In-Charge", "Principal Midwife", "Sister"].every(leadsByGrade)).toBe(true);
    expect(leadsByGrade("Staff Nurse") || leadsByGrade(null)).toBe(false);
  });
  it("starts shift minimums a facility's people can sustain", () => {
    // Sombo: 9 people on shifts. Under the old 4/3/3 it could never be filled.
    const [m, a, n] = starterMinimums("HEALTH_CENTRE", 9);
    expect(m + a + n).toBeLessThanOrEqual(6);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(starterMinimums("CHPS_COMPOUND", 4)).toEqual([1, 1, 1]);
    expect(starterMinimums("REGIONAL_HOSPITAL", 0)).toEqual([4, 3, 3]);
    expect(starterMinimums("HOSPITAL", 60)).toEqual([4, 3, 3]);
  });
});

describe("what each type of facility is offered at registration", () => {
  it("keeps theatre, radiology and specialists to polyclinics and hospitals", () => {
    const chps = portfolioFor("CHPS_COMPOUND");
    const centre = portfolioFor("HEALTH_CENTRE");
    const hospital = portfolioFor("REGIONAL_HOSPITAL");
    expect(chps.cadres).toContain("Community Health Officer");
    expect(chps.cadres).not.toContain("Pharmacist");
    for (const small of [chps, centre]) {
      expect(small.departments).not.toContain("Theatre");
      expect(small.departments).not.toContain("Radiology");
      expect(small.cadres).not.toContain("Specialist");
      expect(small.cadres).not.toContain("Radiographer");
    }
    expect(centre.cadres).toContain("Physician Assistant");
    expect(hospital.departments).toContain("Theatre");
    expect(hospital.cadres).toContain("Specialist");
    expect(portfolioFor("POLYCLINIC")).toEqual(hospital);
  });
});

import { portfolioFor } from "../src/lib/facilitySetup.js";
import { describe, expect, it } from "vitest";
import { cadreDefaults, defaultRunsNights, leadsByGrade, starterMinimums, unitForCadre, unitMinimums } from "../src/lib/dutyPlan.js";

describe("Ghana Health Service cadre defaults", () => {
  it("puts nurses and midwives on shifts with nights", () => {
    for (const n of ["Nurse", "Midwife", "Enrolled Nurse", "Community Health Officer", "Health Assistant"]) {
      expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: false, takesNights: true });
    }
  });
  it("puts the office-hours cadres on weekday mornings", () => {
    for (const n of ["Specialist", "Community Health Nurse", "Radiographer", "Physiotherapist", "Dietician", "Dental Surgeon", "Dental Therapist", "Disease Control Officer", "Health Information Officer"]) {
      expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: true, takesNights: false });
    }
  });
  it("keeps medical officers, accountants and administrators off the duty roster", () => {
    for (const n of ["Medical Officer", "Accountant", "Administrator"]) expect(cadreDefaults(n).onRoster).toBe(false);
  });
  it("gives security, drivers and orderlies nights", () => {
    for (const n of ["Security", "Driver", "Orderly"]) expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: false, takesNights: true });
  });
  it("closes exactly the departments the facilities named at night", () => {
    for (const d of ["Accounts", "Administration", "Antenatal and Postnatal", "Child Welfare", "Dental", "Eye", "Physiotherapy", "Public Health", "Radiology", "Stores"]) expect(defaultRunsNights(d)).toBe(false);
    for (const d of ["Outpatient", "Maternity", "Emergency", "Laboratory", "Clinical Nurses", "Midwives"]) expect(defaultRunsNights(d)).toBe(true);
  });
  it("puts a nurse, midwife or public health cadre in their unit", () => {
    expect(unitForCadre("Enrolled Nurse")?.name).toBe("Clinical Nurses");
    expect(unitForCadre("Nurse")?.name).toBe("Clinical Nurses");
    expect(unitForCadre("Midwife")?.name).toBe("Midwives");
    expect(unitForCadre("Community Health Nurse")?.name).toBe("Public Health");
    expect(unitForCadre("Pharmacist")).toBeNull();
  });
  it("starts clinical nurses at 2/1/1, midwives at 1/1/1, any other unit at the morning only", () => {
    expect(unitMinimums("Clinical Nurses")).toEqual([2, 1, 1]);
    expect(unitMinimums("Midwives")).toEqual([1, 1, 1]);
    expect(unitMinimums("Public Health")).toEqual([1, 0, 0]);
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

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
  it("keeps medical officers and administrators off the duty roster", () => {
    for (const n of ["Medical Officer", "Administrator"]) expect(cadreDefaults(n).onRoster).toBe(false);
  });
  it("gives security, drivers and orderlies nights", () => {
    for (const n of ["Security", "Driver", "Orderly"]) expect(cadreDefaults(n)).toEqual({ onRoster: true, weekdaysOnly: false, takesNights: true });
  });
  it("closes exactly the departments the facilities named at night", () => {
    for (const d of ["Administration", "Antenatal and Postnatal", "Child Welfare", "Dental", "Eye", "Physiotherapy", "Public Health", "Radiology", "Stores"]) expect(defaultRunsNights(d)).toBe(false);
    for (const d of ["Outpatient", "Maternity", "Emergency", "Laboratory", "Clinical Nurses", "Midwives"]) expect(defaultRunsNights(d)).toBe(true);
  });
  it("puts a nurse, midwife or public health cadre in their unit", () => {
    expect(unitForCadre("Enrolled Nurse")?.name).toBe("OPD");
    expect(unitForCadre("Nurse")?.name).toBe("OPD");
    expect(unitForCadre("Midwife")?.name).toBe("Maternity");
    expect(unitForCadre("Community Health Nurse")?.name).toBe("Public Health");
    expect(unitForCadre("Pharmacist")).toBeNull();
  });
  it("starts clinical nurses at 2/1/1, midwives at 1/1/1, any other unit at the morning only", () => {
    expect(unitMinimums("OPD")).toEqual([2, 1, 1]);
    expect(unitMinimums("Clinical Nurses")).toEqual([2, 1, 1]);
    expect(unitMinimums("Maternity")).toEqual([1, 1, 1]);
    expect(unitMinimums("Midwives")).toEqual([1, 1, 1]);
    expect(unitMinimums("Public Health")).toEqual([1, 0, 0]);
    expect(unitMinimums("Laboratory")).toEqual([1, 0, 0]);
  });
  it("lets senior grades lead a shift", () => {
    expect(["Senior Staff Nurse", "Ward In-Charge", "Principal Midwife", "Sister"].every(leadsByGrade)).toBe(true);
    expect(leadsByGrade("Staff Nurse") || leadsByGrade(null)).toBe(false);
  });
  it("starts shift minimums by facility type", () => {
    expect(starterMinimums("CHPS_COMPOUND")).toEqual([1, 1, 1]);
    expect(starterMinimums("CLINIC")).toEqual([1, 1, 1]);
    expect(starterMinimums("HEALTH_CENTRE")).toEqual([2, 1, 1]);
    for (const t of ["POLYCLINIC", "HOSPITAL", "PRIVATE_HOSPITAL"]) expect(starterMinimums(t)).toEqual([4, 3, 3]);
    for (const t of ["REGIONAL_HOSPITAL", "TEACHING_HOSPITAL"]) expect(starterMinimums(t)).toEqual([5, 4, 4]);
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
    // A polyclinic has the wards but not the specialist units of a regional hospital.
    const poly = portfolioFor("POLYCLINIC");
    expect(poly.departments).toContain("Theatre");
    expect(poly.departments).toContain("Male Medical Ward");
    expect(poly.departments).not.toContain("Oncology");
    expect(hospital.departments).toContain("Oncology");
    expect(poly.cadres).toEqual(hospital.cadres);
    // Only a health centre is offered the roster units.
    expect(centre.departments).toContain("OPD");
    expect(centre.departments).not.toContain("Clinical Nurses");
    expect(centre.departments).toContain("Maternity");
    expect(centre.departments).not.toContain("Midwives");
    expect(chps.departments).not.toContain("OPD");
    expect(portfolioFor("CLINIC").departments).not.toContain("OPD");
  });
});

import { beforeEach as beforeEachUnit, describe as describeUnit, expect as expectUnit, it as itUnit } from "vitest";
import { makeFacility, prisma, resetDatabase } from "./helpers.js";
import { seedUnitDemand } from "../src/lib/unitDemand.js";
import { worksWeekdaysOnly } from "../src/lib/dutyPlan.js";

describeUnit("public health works Monday to Friday", () => {
  beforeEachUnit(resetDatabase);

  itUnit("knows which units rest at weekends", () => {
    expectUnit(worksWeekdaysOnly("Public Health")).toBe(true);
    expectUnit(worksWeekdaysOnly("Disease Control")).toBe(true);
    expectUnit(worksWeekdaysOnly("OPD")).toBe(false);
    expectUnit(worksWeekdaysOnly("Maternity")).toBe(false);
  });

  itUnit("starts a public health unit with weekend and holiday cover at 0, and leaves OPD alone", async () => {
    const f = await makeFacility("Sombo Health Centre");
    await prisma.shift.create({ data: { facilityId: f.id, name: "Morning", code: "A", startTime: "08:00", endTime: "14:00", durationHours: 6, minStaff: 2 } });
    const unit = await prisma.department.create({ data: { facilityId: f.id, name: "Disease Control" } });
    const opd = await prisma.department.create({ data: { facilityId: f.id, name: "OPD" } });
    await seedUnitDemand(f.id, unit);
    await seedUnitDemand(f.id, opd);
    const ph = await prisma.shiftDemand.findFirstOrThrow({ where: { departmentId: unit.id } });
    expectUnit([ph.minStaff, ph.weekendMinStaff, ph.holidayMinStaff]).toEqual([1, 0, 0]);
    const o = await prisma.shiftDemand.findFirstOrThrow({ where: { departmentId: opd.id } });
    expectUnit([o.minStaff, o.weekendMinStaff, o.holidayMinStaff]).toEqual([2, null, null]);
  });
});

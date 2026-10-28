// Who works nights and who is on the duty roster. These are the starting
// answers for cadres, departments and in-charges; every facility can change
// them. They mirror the migration that set them for existing facilities.

/** An in-charge works weekday mornings only. */
export const isInCharge = (position: string | null | undefined) => /in[- ]?charge/i.test(position ?? "");

/**
 * Office hours, weekday mornings only (Monday to Friday), as the Ghana Health Service facilities run them:
 * specialists, community health nurses, radiographers, physiotherapists, dieticians, dental surgeons and therapists,
 * disease control and health information officers, and the accountant and administrator.
 */
export const defaultWeekdaysOnly = (cadre: string) =>
  /(specialist|community health nurse|radiograph|physiotherap|dietic|dietit|dental|disease control|health information|health promotion|nutrition|environmental health|public health|occupational health|accountant|administrator)/i.test(cadre);

/** Medical officers and doctors are not on the duty roster, and neither are accountants and administrators. Specialists and dental surgeons are, on office hours. */
export const defaultOnRoster = (cadre: string) =>
  !(/(medical officer|doctor|physician|surgeon|consultant)/i.test(cadre) && !/(assistant|dental)/i.test(cadre)) && !/(accountant|administrator)/i.test(cadre);

/** Nights go to nurses and midwives, health assistants, and the support staff who cover 24 hours (security, drivers, orderlies). */
export const defaultTakesNights = (cadre: string) =>
  defaultOnRoster(cadre) && !defaultWeekdaysOnly(cadre) && /(nurs|midwi|community health|health assist|security|driver|orderl|ward assistant|porter)/i.test(cadre);

/** What a new cadre starts with, from its name. The administrator can change any of it. */
export const cadreDefaults = (cadre: string) => ({ onRoster: defaultOnRoster(cadre), weekdaysOnly: defaultWeekdaysOnly(cadre), takesNights: defaultTakesNights(cadre) });

/** Senior grades take charge of a shift. */
export const leadsByGrade = (position: string | null | undefined) =>
  /(senior|principal|chief|in[- ]?charge|nurse manager|matron|sister|deputy director|head of|supervisor)/i.test(position ?? "");

/**
 * The units of a public health department, each with the cadres who work in it. A facility that has Public Health
 * chooses its units; every unit is a department of its own, so it has its own roster and its own in-charge.
 */
export const PUBLIC_HEALTH_UNITS: { name: string; cadres: string[] }[] = [
  { name: "Disease Control", cadres: ["Disease Control Officer"] },
  { name: "Family Health", cadres: ["Midwife", "Community Health Nurse"] },
  { name: "Reproductive and Child Health", cadres: ["Midwife", "Community Health Nurse"] },
  { name: "Health Promotion", cadres: ["Health Promotion Officer"] },
  { name: "Nutrition", cadres: ["Nutrition Officer"] },
  { name: "Health Information", cadres: ["Health Information Officer"] },
  { name: "Public Health Nursing", cadres: ["Public Health Nurse"] },
  { name: "Malaria Control", cadres: ["Disease Control Officer"] },
  { name: "Tuberculosis and Priority Diseases", cadres: ["Disease Control Officer"] },
  { name: "Occupational Health", cadres: ["Occupational Health Officer"] },
  { name: "Mental Health", cadres: ["Psychiatric Nurse"] },
  { name: "Environmental Health and Sanitation", cadres: ["Environmental Health Officer"] },
];
export const isPublicHealthUnit = (name: string) => PUBLIC_HEALTH_UNITS.some((u) => u.name.toLowerCase() === name.trim().toLowerCase());

/** The wards and departments of a hospital. A polyclinic has the smaller set; regional and teaching hospitals add their specialist units. */
const POLYCLINIC_WARDS = ["Outpatient", "Emergency", "Male Medical Ward", "Female Medical Ward", "Paediatric Ward", "Labour Ward", "Maternity Ward", "Antenatal and Postnatal", "Child Welfare", "Theatre", "Dental", "Eye", "Physiotherapy", "Laboratory", "Pharmacy", "Radiology", "Records", "Stores", "Transport", "Support Services"];
const HOSPITAL_WARDS = ["Outpatient", "Emergency", "Male Medical Ward", "Female Medical Ward", "Male Surgical Ward", "Female Surgical Ward", "Paediatric Ward", "Special Care Baby Unit", "Labour Ward", "Maternity Ward", "Antenatal and Postnatal", "Gynaecology Ward", "Child Welfare", "Theatre", "Recovery Room", "Intensive Care", "Orthopaedic and Trauma Ward", "Isolation Ward", "Eye", "ENT", "Dental", "Psychiatry", "Physiotherapy", "Laboratory", "Blood Bank", "Pharmacy", "Radiology", "Mortuary", "Records", "Stores", "Transport", "Support Services"];
const REGIONAL_EXTRA = ["Neonatal Intensive Care", "Renal and Dialysis", "Oncology", "Burns and Plastic Surgery", "Cardiology", "Neurology", "Urology", "Amenity Ward"];
const TEACHING_EXTRA = ["Neurosurgery", "Cardiothoracic Surgery", "Paediatric Intensive Care", "Endocrinology and Diabetes", "Haematology", "Paediatric Surgery"];
export const WARDS_BY_TYPE: Record<string, string[]> = {
  POLYCLINIC: [...POLYCLINIC_WARDS, "Public Health", ...PUBLIC_HEALTH_UNITS.map((u) => u.name)],
  HOSPITAL: [...HOSPITAL_WARDS, "Public Health", ...PUBLIC_HEALTH_UNITS.map((u) => u.name)],
  PRIVATE_HOSPITAL: [...HOSPITAL_WARDS, "Public Health", ...PUBLIC_HEALTH_UNITS.map((u) => u.name)],
  REGIONAL_HOSPITAL: [...HOSPITAL_WARDS, ...REGIONAL_EXTRA, "Public Health", ...PUBLIC_HEALTH_UNITS.map((u) => u.name)],
  TEACHING_HOSPITAL: [...HOSPITAL_WARDS, ...REGIONAL_EXTRA, ...TEACHING_EXTRA, "Public Health", ...PUBLIC_HEALTH_UNITS.map((u) => u.name)],
};

/** The departments that do not run night duty, as the Ghana Health Service facilities have them. Every other department runs nights. */
const NO_NIGHT_DEPARTMENTS = ["administration", "antenatal and postnatal", "child welfare", "dental", "eye", "physiotherapy", "public health", "radiology", "stores", "ent", "family planning", "antenatal clinic", "child welfare clinic", ...PUBLIC_HEALTH_UNITS.map((u) => u.name.toLowerCase())];
export const defaultRunsNights = (department: string) => !NO_NIGHT_DEPARTMENTS.includes(department.trim().toLowerCase());

export const STANDARD_CADRES = ["Medical Officer", "Specialist", "Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Community Health Nurse", "Community Health Officer", "Nurse Anaesthetist", "Pharmacist", "Pharmacy Technician", "Laboratory Scientist", "Laboratory Technician", "Radiographer", "Physiotherapist", "Dietician", "Dental Surgeon", "Dental Therapist", "Disease Control Officer", "Health Information Officer", "Public Health Nurse", "Psychiatric Nurse", "Environmental Health Officer", "Health Promotion Officer", "Nutrition Officer", "Occupational Health Officer", "Health Assistant", "Ward Assistant", "Orderly", "Driver", "Security", "Cleaner"];
export const STANDARD_DEPARTMENTS = ["Outpatient", "Maternity", "Antenatal and Postnatal", "Child Welfare", "Emergency", "Surgery", "Medicine", "Paediatrics", "Theatre", "Intensive Care", "Laboratory", "Pharmacy", "Radiology", "Dental", "Eye", "Physiotherapy", "Public Health", "Records", "Stores", "Transport", "Mortuary", "Support Services"];
/** The units a health centre rosters by, plus the support units. */
const UNIT_NAMES = ["OPD", "Clinical Nurses", "Maternity", "Midwives", "Security", "Drivers", "Cleaners"];

/** The standard cadres and departments carry fixed night and office-hour settings. Ones the facility adds itself are free to change. */
export const isStandardCadre = (name: string) => STANDARD_CADRES.some((c) => c.toLowerCase() === name.trim().toLowerCase());
export const isStandardDepartment = (name: string) => [...STANDARD_DEPARTMENTS, ...UNIT_NAMES, ...Object.values(WARDS_BY_TYPE).flat()].some((d) => d.toLowerCase() === name.trim().toLowerCase());

/** The roster unit a health centre or CHPS compound puts someone in, from their cadre. */
export function unitForCadre(cadre: string | null | undefined): { name: string; runsNights: boolean } | null {
  const c = cadre ?? "";
  if (/midwi/i.test(c)) return { name: "Maternity", runsNights: true };
  if (/(^nurse$|enrolled nurse|staff nurse|registered|general nurse)/i.test(c.trim())) return { name: "OPD", runsNights: true };
  if (/(community health|public health|disease control)/i.test(c)) return { name: "Public Health", runsNights: false };
  return null;
}

/** The public health unit a cadre belongs to, where only one fits. A facility that has the unit places the person in it when they join. */
export function publicHealthUnitForCadre(cadre: string | null | undefined): string | null {
  const c = (cadre ?? "").trim().toLowerCase();
  const hit = PUBLIC_HEALTH_UNITS.find((u) => u.cadres.length === 1 && u.cadres[0].toLowerCase() === c && !/disease control/.test(c));
  if (hit) return hit.name;
  return c === "disease control officer" ? "Disease Control" : null;
}

/** What a unit starts needing on its morning, afternoon and night shifts. OPD 2/1/1, maternity 1/1/1, public health nothing until its figure is agreed, any other unit the morning only. */
export function unitMinimums(unit: string): [number, number, number] {
  const u = unit.trim().toLowerCase();
  if (u === "opd" || u === "clinical nurses") return [2, 1, 1];
  if (u === "maternity" || u === "midwives") return [1, 1, 1];
  // Public health has no agreed figure yet, so it starts empty for the in-charge to set. Change this line when it is agreed.
  if (u === "public health") return [0, 0, 0];
  return [1, 0, 0];
}

/** Security, drivers and cleaners are rostered by the administrator; accounts and administration have no roster. */
export const defaultKind = (department: string): "WARD" | "SUPPORT" | "OFFICE" =>
  /(secur|driver|transport|clean|orderl|porter|laundry|kitchen|catering|mortuar)/i.test(department)
    ? "SUPPORT"
    : /(account|administration|^admin|finance|records|stores|procure|human resource|^hr$|audit)/i.test(department)
      ? "OFFICE"
      : "WARD";

/**
 * Morning, afternoon and night minimums a new facility starts with, by type. They are only a starting point:
 * every facility can change them. Busier facilities need more on each shift: polyclinics and hospitals 4/3/3,
 * regional and teaching hospitals 5/4/4. A health centre starts at 2/1/1; a clinic and a CHPS compound, smaller than a health centre, at 1/1/1.
 */
export function starterMinimums(facilityType: string): [number, number, number] {
  const base: Record<string, [number, number, number]> = {
    CHPS_COMPOUND: [1, 1, 1],
    CLINIC: [1, 1, 1],
    HEALTH_CENTRE: [2, 1, 1],
    REGIONAL_HOSPITAL: [5, 4, 4],
    TEACHING_HOSPITAL: [5, 4, 4],
  };
  return base[facilityType] ?? [4, 3, 3];
}

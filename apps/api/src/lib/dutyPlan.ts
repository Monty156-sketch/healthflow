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
  /(specialist|community health nurse|radiograph|physiotherap|dietic|dietit|dental|disease control|health information|accountant|administrator)/i.test(cadre);

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

/** The departments that do not run night duty, as the Ghana Health Service facilities have them. Every other department runs nights. */
const NO_NIGHT_DEPARTMENTS = ["accounts", "administration", "antenatal and postnatal", "child welfare", "dental", "eye", "physiotherapy", "public health", "radiology", "stores"];
export const defaultRunsNights = (department: string) => !NO_NIGHT_DEPARTMENTS.includes(department.trim().toLowerCase());

export const STANDARD_CADRES = ["Medical Officer", "Specialist", "Physician Assistant", "Midwife", "Nurse", "Enrolled Nurse", "Community Health Nurse", "Community Health Officer", "Nurse Anaesthetist", "Pharmacist", "Pharmacy Technician", "Laboratory Scientist", "Laboratory Technician", "Radiographer", "Physiotherapist", "Dietician", "Dental Surgeon", "Dental Therapist", "Disease Control Officer", "Health Information Officer", "Health Assistant", "Ward Assistant", "Orderly", "Accountant", "Administrator", "Driver", "Security", "Cleaner"];
export const STANDARD_DEPARTMENTS = ["Outpatient", "Maternity", "Antenatal and Postnatal", "Child Welfare", "Emergency", "Surgery", "Medicine", "Paediatrics", "Theatre", "Intensive Care", "Laboratory", "Pharmacy", "Radiology", "Dental", "Eye", "Physiotherapy", "Public Health", "Records", "Administration", "Accounts", "Stores", "Transport", "Mortuary", "Support Services"];
/** The units a health centre rosters by, plus the support units. */
const UNIT_NAMES = ["Clinical Nurses", "Midwives", "Security", "Drivers", "Cleaners"];

/** The standard cadres and departments carry fixed night and office-hour settings. Ones the facility adds itself are free to change. */
export const isStandardCadre = (name: string) => STANDARD_CADRES.some((c) => c.toLowerCase() === name.trim().toLowerCase());
export const isStandardDepartment = (name: string) => [...STANDARD_DEPARTMENTS, ...UNIT_NAMES].some((d) => d.toLowerCase() === name.trim().toLowerCase());

/** The roster unit a health centre or CHPS compound puts someone in, from their cadre. */
export function unitForCadre(cadre: string | null | undefined): { name: string; runsNights: boolean } | null {
  const c = cadre ?? "";
  if (/midwi/i.test(c)) return { name: "Midwives", runsNights: true };
  if (/(^nurse$|enrolled nurse|staff nurse|registered|general nurse)/i.test(c.trim())) return { name: "Clinical Nurses", runsNights: true };
  if (/(community health|public health|disease control)/i.test(c)) return { name: "Public Health", runsNights: false };
  return null;
}

/** What a unit starts needing on its morning, afternoon and night shifts. Clinical nurses 2/1/1, midwives 1/1/1, any other unit the morning only. */
export function unitMinimums(unit: string): [number, number, number] {
  const u = unit.trim().toLowerCase();
  if (u === "clinical nurses") return [2, 1, 1];
  if (u === "midwives") return [1, 1, 1];
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
 * Morning, afternoon and night minimums to start from. A CHPS compound or health centre runs lean; a hospital ward more.
 * Held to what the people on shifts can sustain (about seven duties for every ten people a day), cutting the afternoon first. Nights keep at least one.
 */
export function starterMinimums(facilityType: string, onShifts: number): [number, number, number] {
  const base: Record<string, [number, number, number]> = { CHPS_COMPOUND: [1, 1, 1], HEALTH_CENTRE: [2, 2, 1], CLINIC: [2, 2, 1], POLYCLINIC: [3, 2, 2] };
  const [m0, a0, n0] = base[facilityType] ?? [4, 3, 3];
  if (onShifts <= 0) return [m0, a0, n0];
  const cap = Math.max(3, Math.floor(onShifts * 0.7));
  let [m, a, n] = [m0, a0, n0];
  while (m + a + n > cap && (a > 1 || m > 1 || n > 1)) {
    if (a > 1) a--;
    else if (m > 1) m--;
    else n--;
  }
  return [m, a, n];
}

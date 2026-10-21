// Who works nights and who is on the duty roster. These are the starting
// answers for cadres, departments and in-charges; every facility can change
// them. They mirror the migration that set them for existing facilities.

/** An in-charge works weekday mornings only. */
export const isInCharge = (position: string | null | undefined) => /in[- ]?charge/i.test(position ?? "");

/** Office hours, weekday day shift only: pharmacy, laboratory, imaging, therapy, records, disease control, physician assistants. */
export const defaultWeekdaysOnly = (cadre: string) =>
  /(pharmac|laborator|radiograph|physiotherap|dietic|nutrition|dental|disease control|health information|records|physician assistant|medical assistant|public health|environmental)/i.test(cadre);

/** Doctors are not on the duty roster, and neither are accountants and administrators. */
export const defaultOnRoster = (cadre: string) =>
  !(/(medical officer|specialist|doctor|physician|surgeon|consultant)/i.test(cadre) && !/assistant/i.test(cadre)) && !/(accountant|administrator)/i.test(cadre);

/** Nights go to nurses and midwives, health assistants, and the support staff who cover 24 hours (security, drivers, orderlies). */
export const defaultTakesNights = (cadre: string) =>
  defaultOnRoster(cadre) && !defaultWeekdaysOnly(cadre) && /(nurs|midwi|community health|health assist|security|driver|orderl|ward assistant|porter)/i.test(cadre);

/** What a new cadre starts with, from its name. The administrator can change any of it. */
export const cadreDefaults = (cadre: string) => ({ onRoster: defaultOnRoster(cadre), weekdaysOnly: defaultWeekdaysOnly(cadre), takesNights: defaultTakesNights(cadre) });

/** Senior grades take charge of a shift. */
export const leadsByGrade = (position: string | null | undefined) =>
  /(senior|principal|chief|in[- ]?charge|nurse manager|matron|sister|deputy director|head of|supervisor)/i.test(position ?? "");

/** Departments that close at night. */
export const defaultRunsNights = (department: string) =>
  !/(^eye|ophthal|optom|dental|physio|dermat|^ent$|ear,? nose|outpatient|^opd|records|administration|accounts|stores|transport|public health|child welfare)/i.test(department);

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

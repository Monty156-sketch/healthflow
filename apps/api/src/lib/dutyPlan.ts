// Who works nights and who is on the duty roster. These are the starting
// answers for cadres, departments and in-charges; every facility can change
// them. They mirror the migration that set them for existing facilities.

/** An in-charge works weekday mornings only. */
export const isInCharge = (position: string | null | undefined) => /in[- ]?charge/i.test(position ?? "");

/** Nights go to nurses and midwives, with health assistants. */
export const defaultTakesNights = (cadre: string) => /(nurs|midwi|community health|health assist)/i.test(cadre);

/** Doctors are not on the duty roster. */
export const defaultOnRoster = (cadre: string) => !(/(medical officer|specialist|doctor|physician|surgeon|consultant)/i.test(cadre) && !/assistant/i.test(cadre));

/** Departments that close at night. */
export const defaultRunsNights = (department: string) =>
  !/(^eye|ophthal|optom|dental|physio|dermat|^ent$|ear,? nose|outpatient|^opd|records|administration|accounts|stores|transport|public health|child welfare)/i.test(department);

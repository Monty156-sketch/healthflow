// Words for audit sentences. The spec asks that every audit entry "reads as
// a sentence naming people and dates", so enums and dates are turned into
// the words a facility admin would use.

export const STAFF_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
  TRANSFERRED: "Transferred",
  RESIGNED: "Resigned",
  RETIRED: "Retired",
};

export const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  NATIONAL_SERVICE: "National Service",
  LOCUM: "Locum",
};

export const FACILITY_TYPE_LABEL: Record<string, string> = {
  CHPS_COMPOUND: "CHPS Compound",
  HEALTH_CENTRE: "Health Centre",
  CLINIC: "Clinic",
  POLYCLINIC: "Polyclinic",
  HOSPITAL: "Hospital",
  PRIVATE_HOSPITAL: "Private Hospital",
};

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function weekdayLabel(n: number): string {
  return WEEKDAY[n % 7] ?? String(n);
}

const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export function monthLabel(n: number): string {
  return MONTH[n - 1] ?? String(n);
}

/** Display format from the standing instructions: DD/MM/YYYY. */
export function displayDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Export/API format from the standing instructions: YYYY-MM-DD. */
export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** "a, b and c" */
export function listSentence(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

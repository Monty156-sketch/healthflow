// Words and formats the screens share. Dates follow the standing
// instructions: shown as DD/MM/YYYY, sent and stored as YYYY-MM-DD.
import type { StatusTone } from "@/components/ui";

export const STAFF_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  ON_LEAVE: { label: "On leave", tone: "warning" },
  PENDING: { label: "Pending", tone: "neutral" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  TRANSFERRED: { label: "Transferred", tone: "neutral" },
  RESIGNED: { label: "Resigned", tone: "neutral" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

/** Statuses that end a person's access to HealthFlow. */
export const LEAVING_STATUSES = ["INACTIVE", "TRANSFERRED", "RESIGNED", "RETIRED"];

export const EMPLOYMENT: Record<string, string> = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  NATIONAL_SERVICE: "National Service",
  LOCUM: "Locum",
};

export const FACILITY_TYPE: Record<string, string> = {
  CHPS_COMPOUND: "CHPS Compound",
  HEALTH_CENTRE: "Health Centre",
  CLINIC: "Clinic",
  POLYCLINIC: "Polyclinic",
  HOSPITAL: "Hospital",
  PRIVATE_HOSPITAL: "Private Hospital",
};

export const ROLE: Record<string, string> = {
  PLATFORM_ADMIN: "Platform admin",
  FACILITY_ADMIN: "Facility admin",
  ROSTER_MANAGER: "Roster manager",
  SUPERVISOR: "Supervisor",
  STAFF: "Staff",
  DISTRICT_OFFICER: "District officer",
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2024-08-14" -> "14/08/2024" */
export function showDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** A timestamp in the viewer's local time: "14/08/2024, 09:05" */
export function showDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()}, ${p(t.getHours())}:${p(t.getMinutes())}`;
}

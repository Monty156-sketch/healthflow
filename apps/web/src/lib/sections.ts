// Pages that belong together. Each section is one entry in the menu (or, for
// the platform console and the district pages, none: they are reached by
// their address) and its pages show as a row of tabs above the page.

export interface Tab {
  href: string;
  label: string;
  roles: string[];
  /** Hidden while this feature flag exists and is off for the facility. */
  flag?: string;
}

export interface Section {
  id: "duties" | "leave" | "attendance" | "settings" | "platform" | "district";
  tabs: Tab[];
}

const READ = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"];
const EVERYONE = [...READ, "STAFF"];
const ADMIN = ["FACILITY_ADMIN"];
const PLATFORM = ["PLATFORM_ADMIN"];
const DISTRICT = ["DISTRICT_OFFICER"];

export const SECTIONS: Section[] = [
  {
    id: "duties",
    tabs: [
      { href: "/my-duties", label: "My duties", roles: EVERYONE },
      { href: "/swaps", label: "Duty swaps", roles: EVERYONE },
      { href: "/cover", label: "Cover", roles: READ },
      { href: "/ledger", label: "Duty ledger", roles: READ },
    ],
  },
  {
    id: "leave",
    tabs: [
      { href: "/leave", label: "Leave requests", roles: EVERYONE },
      { href: "/leave/calendar", label: "Leave calendar", roles: READ },
      { href: "/settings/leave-types", label: "Leave types", roles: ADMIN },
      { href: "/settings/entitlements", label: "Leave entitlements", roles: ADMIN },
      { href: "/settings/holidays", label: "Public holidays", roles: ADMIN },
    ],
  },
  {
    id: "attendance",
    tabs: [
      { href: "/attendance", label: "Daily attendance", roles: READ },
      { href: "/attendance/month", label: "Monthly attendance", roles: READ },
    ],
  },
  {
    id: "settings",
    tabs: [
      { href: "/settings", label: "Facility settings", roles: ADMIN },
      { href: "/settings/establishment", label: "Approved posts", roles: ADMIN },
      { href: "/rules", label: "Compliance rules", roles: READ },
      { href: "/directorate-access", label: "Directorate access", roles: ADMIN, flag: "district.oversight" },
      { href: "/privacy-and-data", label: "Privacy and data protection", roles: ADMIN },
      { href: "/audit-log", label: "Audit log", roles: ADMIN },
    ],
  },
  {
    id: "platform",
    tabs: [
      { href: "/platform", label: "Console", roles: PLATFORM },
      { href: "/platform/requests", label: "Access requests", roles: PLATFORM },
      { href: "/platform/facilities", label: "Facilities", roles: PLATFORM },
      { href: "/platform/billing", label: "Billing", roles: PLATFORM },
      { href: "/platform/support", label: "Support access", roles: PLATFORM },
      { href: "/platform/users", label: "Users", roles: PLATFORM },
      { href: "/platform/legal", label: "Legal documents", roles: PLATFORM },
      { href: "/platform/announcements", label: "Announcements", roles: PLATFORM },
      { href: "/platform/flags", label: "Feature flags", roles: PLATFORM },
      { href: "/platform/errors", label: "Error reports", roles: PLATFORM },
      { href: "/platform/districts", label: "Districts", roles: PLATFORM },
      { href: "/system-health", label: "System health", roles: PLATFORM },
    ],
  },
  {
    id: "district",
    tabs: [
      { href: "/district", label: "Overview", roles: DISTRICT },
      { href: "/district/facilities", label: "Facilities", roles: DISTRICT },
      { href: "/district/coverage", label: "Coverage monitor", roles: DISTRICT },
      { href: "/district/establishment", label: "Establishment", roles: DISTRICT },
      { href: "/district/leave", label: "Leave concentration", roles: DISTRICT },
      { href: "/district/reports", label: "Report pack", roles: DISTRICT },
      { href: "/district/profile", label: "District profile", roles: DISTRICT },
    ],
  },
];

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The section a page belongs to, and which of its tabs is the current one (the longest match across all sections). */
export function sectionFor(pathname: string): { section: Section; current: string } | null {
  let best: { section: Section; current: string } | null = null;
  for (const section of SECTIONS) {
    for (const t of section.tabs) {
      if (within(pathname, t.href) && (!best || t.href.length > best.current.length)) best = { section, current: t.href };
    }
  }
  return best;
}

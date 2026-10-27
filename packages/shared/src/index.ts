// Constants shared between apps/web and apps/api, so a shift code or a rule
// code is spelled once rather than copied into each app separately.

export const SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const ACCESS_TOKEN_TTL_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 30; // absolute cap; idle timeout enforced separately
export const LOCKOUT_AFTER_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

// The twelve constraint rules, Part 3, section 1.2 of the documentation.
export const CONSTRAINT_RULE_CODES = [
  "C1", // Maximum normal hours per day
  "C2", // Maximum normal hours per week
  "C3", // Weekly consecutive rest
  "C4", // Reference-period average weekly hours
  "C5", // Minimum rest between shifts
  "C6", // Physically impossible sequence
  "C7", // Maximum consecutive duty days
  "C8", // Maximum consecutive night duties
  "C9", // Assignment during approved leave
  "C10", // Cadre or staff not eligible for shift
  "C11", // Minimum staffing per shift
  "C12", // Night duty distribution
] as const;

export type ConstraintRuleCode = (typeof CONSTRAINT_RULE_CODES)[number];

// Roles, mirrored from the Prisma enum so the frontend can type-check
// against them without importing the generated Prisma client.
export const ROLES = [
  "PLATFORM_ADMIN",
  "FACILITY_ADMIN",
  "ROSTER_MANAGER",
  "SUPERVISOR",
  "STAFF",
  "DISTRICT_OFFICER",
] as const;

export type AppRole = (typeof ROLES)[number];

export const ROLES_REQUIRING_MFA: AppRole[] = [
  "FACILITY_ADMIN",
  "PLATFORM_ADMIN",
  "DISTRICT_OFFICER",
];

// Design tokens — Part 2 of the documentation's standing instructions.
export const DESIGN_TOKENS = {
  colors: {
    groundLight: "#F4F7F5",
    textLight: "#12262B",
    groundDark: "#0D1416",
    textDark: "#F4F7F5",
    accent: "#0E6B6B",
    shiftMorning: "#B56B12",
    shiftAfternoon: "#25619F",
    shiftNight: "#463A85",
    shiftOffDuty: "#77878A",
    block: "#9E2B2B",
    warning: "#A87111",
    success: "#2A7049",
  },
} as const;

// Colours a shift can use. A fixed set, not free choice, so every chip stays
// readable on the roster grid in light and dark mode.
export const SHIFT_COLOURS = [
  { value: "#b56b12", name: "Amber" },
  { value: "#25619f", name: "Blue" },
  { value: "#463a85", name: "Indigo" },
  { value: "#77878a", name: "Grey" },
  { value: "#1f6f66", name: "Teal" },
  { value: "#9b3b52", name: "Rose" },
  { value: "#5c6b1f", name: "Olive" },
  { value: "#3d5a73", name: "Slate" },
] as const;
export * from "./geography.js";

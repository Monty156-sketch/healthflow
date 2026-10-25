// Who runs a facility or a supervising office in Ghana.
export const AGENCY_CODES = ["GHS", "CHAG", "AMMG", "PRIVATE"] as const;
export type AgencyCode = (typeof AGENCY_CODES)[number];

export const AGENCY_NAMES: Record<AgencyCode, string> = {
  GHS: "Ghana Health Service",
  CHAG: "CHAG (Christian Health Association of Ghana)",
  AMMG: "Ahmadiyya Muslim Mission Ghana (AMMG)",
  PRIVATE: "Private",
};
export const agencyName = (a: string) => AGENCY_NAMES[a as AgencyCode] ?? a;
export const AGENCY_MESSAGE = "Choose who runs the facility: Ghana Health Service, CHAG, AMMG or Private.";

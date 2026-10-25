// Who runs a facility or a district directorate in Ghana.
export const AGENCIES: [string, string][] = [
  ["GHS", "Ghana Health Service"],
  ["CHAG", "CHAG (Christian Health Association of Ghana)"],
  ["AMMG", "Ahmadiyya Muslim Mission Ghana (AMMG)"],
  ["PRIVATE", "Private"],
];
export const agencyName = (k: string | null | undefined) => AGENCIES.find(([a]) => a === k)?.[1] ?? "Ghana Health Service";

// Handover notes must not carry patient identity. A note is read by the whole ward and kept for 90 days, so a name in it is
// a disclosure. No program can recognise every name, so this blocks the clear signs: a title or relationship followed by a name,
// "patient named X", phone numbers, long ID or folder numbers, and two capitalised words in a row that are not a known ward,
// shift, cadre or colleague. The writer is told what to change. Bed numbers and ages are fine.

const TITLE_WORDS = ["mr", "mrs", "miss", "ms", "madam", "master", "nana", "alhaji", "alhaja", "hajia", "pastor", "rev", "chief", "baby", "infant", "child", "boy", "girl", "lady", "man", "woman", "mother", "father", "wife", "husband", "brother", "son", "daughter", "mama", "papa", "auntie", "uncle"];
// The title may be written in any case, but the name that follows must start with a capital.
const caseless = (w: string) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`;
const TITLED = new RegExp(`\\b(?:${TITLE_WORDS.map(caseless).join("|")})\\.?\\s+(?:of\\s+)?([A-Z][a-z]{2,})`, "g");
const NAMED = /\b(?:patient|pt|client|case|mother|baby|child|man|woman|boy|girl)\s+(?:is\s+)?(?:named|called|name\s+is|by\s+name)\b|\bname\s*(?:is|:)\s*[A-Za-z]/gi;
const PHONE = /(?:\+?233|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const LONG_NUMBER = /\b\d{7,}\b|\bGHA[-\s]?\d{6,}\b|\b(?:NHIS|folder|file|card|reg(?:istration)?)\s*(?:no\.?|number|#|:)?\s*[A-Z]*[-\s]?\d{4,}\b/gi;
const CAPITAL_PAIR = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;
// Titles that belong to staff are fine; "Dr Mensah" is a colleague, not a patient.
const STAFF_TITLES = /\b(?:dr|doctor|nurse|midwife|sister|matron|sr|snr|pa|ps)\.?\s+[A-Z][a-z]+/g;

export interface PatientHit { text: string; why: string }

const words = (xs: string[]) => new Set(xs.flatMap((x) => x.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2));

/**
 * What in the text looks like patient identity. `known` holds names the ward legitimately uses: its own name, shifts, cadres,
 * the facility and the staff, so "Female Ward" and "Night Shift" and a colleague's name are not flagged.
 */
export function patientIdentifiers(text: string, known: string[] = [], people: string[] = []): PatientHit[] {
  const hits: PatientHit[] = [];
  const allowed = words(known);
  // A colleague is allowed only by full name. Their first name alone would let a patient with the same first name through.
  const colleagues = new Set(people.map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()));
  // Remove colleagues' titled names first so they do not count.
  const cleaned = text.replace(STAFF_TITLES, " ");
  for (const m of cleaned.matchAll(TITLED)) {
    const name = m[1].toLowerCase();
    if (!allowed.has(name) && !COMMON.has(name)) hits.push({ text: m[0], why: "a title or relationship followed by a name" });
  }
  for (const m of cleaned.matchAll(NAMED)) hits.push({ text: m[0], why: "a patient being named" });
  for (const m of cleaned.matchAll(PHONE)) hits.push({ text: m[0], why: "a phone number" });
  for (const m of cleaned.matchAll(LONG_NUMBER)) hits.push({ text: m[0], why: "an ID, folder or card number" });
  for (const m of cleaned.matchAll(CAPITAL_PAIR)) {
    const parts = m[0].toLowerCase().split(/\s+/);
    if (colleagues.has(parts.join(" "))) continue;
    if (parts.every((p) => allowed.has(p))) continue;
    if (parts.some((p) => allowed.has(p))) continue;
    if (parts.some((p) => COMMON.has(p))) continue;
    hits.push({ text: m[0], why: "what looks like a person's name" });
  }
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.text.toLowerCase()) ? false : (seen.add(h.text.toLowerCase()), true)));
}

/** Capitalised words that start clinical or ward phrases, so "Blood Pressure" or "Intensive Care" is not read as a name. */
const COMMON = new Set([
  "blood", "pressure", "intensive", "care", "labour", "ward", "theatre", "delivery", "emergency", "male", "female", "children", "paediatric", "maternity", "surgical", "medical", "night", "morning", "afternoon", "evening", "shift", "bed", "oxygen", "drip", "iv", "insulin", "malaria", "typhoid", "sickle", "cell", "heart", "kidney", "liver", "lung", "chest", "head", "post", "pre", "operative", "caesarean", "section", "ultrasound", "blood", "transfusion", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december", "health", "centre", "hospital", "clinic", "regional", "teaching", "district", "ghana", "service", "theatre", "recovery", "isolation", "high", "dependency", "unit", "pharmacy", "laboratory", "store", "stores", "generator", "power", "water", "supply",
]);

/** A sentence telling the writer what to change, or null when the text is clean. */
export function patientProblem(text: string | null | undefined, known: string[], people: string[] = []): string | null {
  if (!text) return null;
  const hits = patientIdentifiers(text, known, people);
  if (hits.length === 0) return null;
  const shown = hits.slice(0, 3).map((h) => `"${h.text}" (${h.why})`).join(", ");
  return `This looks like it names a patient: ${shown}. Use the bed number and say what needs doing, with no names, phone or ID numbers.`;
}

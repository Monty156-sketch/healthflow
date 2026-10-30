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
const CAPITAL_PAIR = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;
// Titles that belong to staff are fine; "Dr Mensah" is a colleague, not a patient.
const STAFF_TITLES = /\b(?:dr|doctor|nurse|midwife|sister|matron|sr|snr|pa|ps)\.?\s+[A-Z][a-z]+/g;

/** Ordinary words that start sentences or phrases, so "The Roster" or "Please Call" is not read as a person's name. */
const STOP = new Set(["the", "this", "that", "these", "those", "please", "when", "while", "after", "before", "our", "your", "their", "his", "her", "its", "and", "but", "for", "from", "with", "without", "since", "because", "however", "also", "then", "there", "here", "what", "why", "how", "who", "can", "could", "would", "should", "will", "does", "did", "not", "all", "any", "some", "every", "each", "new", "old", "good", "very", "much", "more", "most", "app", "page", "screen", "button", "menu", "list", "link", "email", "phone", "roster", "rosters", "leave", "swap", "swaps", "cover", "duty", "duties", "staff", "report", "reports", "login", "sign", "password", "reset", "settings", "dashboard", "billing", "ledger", "attendance", "handover", "notes", "healthflow"]);

/** Common first names in Ghana (Akan day names, Ewe, Ga, northern and Muslim, and widely used Christian names). A lone one is read as a person. */
const FIRST_NAMES = new Set(["kofi", "kwame", "kwabena", "kwaku", "yaw", "kojo", "kwadwo", "kwasi", "kwesi", "kobina", "fiifi", "ama", "abena", "akua", "yaa", "afia", "efua", "adwoa", "akosua", "esi", "araba", "abenaa", "afua", "adjoa", "nana", "kweku", "nii", "naa", "kpakpo", "mensah", "owusu", "boateng", "asante", "agyeman", "osei", "appiah", "amoah", "darko", "tetteh", "mensa", "ofori", "frimpong", "badu", "adjei", "ankrah", "quaye", "lamptey", "dery", "dakurah", "naamwin", "bayor", "tuoyire", "kuubaar", "mohammed", "muhammad", "mohamed", "abdul", "abdulai", "abdullah", "alhassan", "alhaji", "ibrahim", "issah", "issaka", "mahama", "musa", "sumaila", "fatima", "fatimah", "zainab", "hawa", "amina", "aminata", "rahma", "rukaya", "habiba", "sulemana", "iddrisu", "yakubu", "adam", "salifu", "seidu", "samata", "mariama", "memuna", "ayishetu", "john", "james", "joseph", "peter", "paul", "samuel", "daniel", "michael", "david", "emmanuel", "isaac", "stephen", "francis", "richard", "patrick", "mary", "grace", "gifty", "comfort", "mercy", "faustina", "felicia", "patience", "juliet", "janet", "agnes", "dorcas", "ruth", "sarah", "rebecca", "elizabeth", "cecilia", "beatrice", "vida", "linda", "doris", "gladys", "irene", "joyce", "lydia", "priscilla", "rita", "theresa", "veronica", "anita", "diana", "eunice", "florence", "georgina", "helena", "ivy", "justina", "lilian", "monica", "nancy", "portia", "regina", "sandra", "victoria", "yvonne"]);

const STAFF_TITLES_ANY_CASE = new RegExp(`\\b(?:${["dr", "doctor", "nurse", "midwife", "sister", "matron", "sr", "snr", "pa", "ps"].map(caseless).join("|")})\\.?\\s+[A-Z][a-z]+`, "g");

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
    if (parts.some((p) => STOP.has(p))) continue;
    if (colleagues.has(parts.join(" "))) continue;
    if (parts.every((p) => allowed.has(p))) continue;
    if (parts.some((p) => allowed.has(p))) continue;
    if (parts.some((p) => COMMON.has(p))) continue;
    hits.push({ text: m[0], why: "what looks like a person's name" });
  }
  // A single capitalised word that is a common first name, unless a colleague uses exactly that name.
  // Colleagues written with their full name do not count, so take them out first.
  let rest = text;
  for (const c of colleagues) rest = rest.replace(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  rest = rest.replace(STAFF_TITLES_ANY_CASE, " ");
  for (const m of rest.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    const w = m[0].toLowerCase();
    if (FIRST_NAMES.has(w) && !allowed.has(w) && !COMMON.has(w) && !colleagues.has(w)) hits.push({ text: m[0], why: "what looks like a person's name" });
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

/** Like patientProblem, and says whether the writer may confirm the text is clean. Only name-like guesses can be confirmed; phone, ID and "patient named" cannot. */
export function patientCheck(text: string | null | undefined, known: string[], people: string[] = []): { problem: string; canConfirm: boolean } | null {
  const problem = patientProblem(text, known, people);
  if (!problem || !text) return null;
  const hits = patientIdentifiers(text, known, people);
  return { problem, canConfirm: hits.every((h) => h.why === "what looks like a person's name") };
}

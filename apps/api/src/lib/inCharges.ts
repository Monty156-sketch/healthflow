// The administrator's list of in-charges: who they are, their rank and their ward.
// A person who signs up with a listed name is placed from the list, so nobody can pick an in-charge's ward for themselves.
export const nameKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

import { describe, expect, it } from "vitest";
import { patientCheck, patientIdentifiers, patientProblem } from "../src/lib/patientData.js";

const known = ["Female Ward", "Night", "Sombo Health Centre", "Staff Nurse"];
const people = ["Ama Mensah", "Kofi Bawa"];

describe("patient identity in handover text", () => {
  it("lets ordinary handover wording through", () => {
    for (const t of [
      "Quiet night. Bed 4 on drip, review at 06:00. Bed 7 aged 34 for theatre.",
      "Female Ward was full. Staff Nurse Ama Mensah gave the 02:00 round. Dr Mensah called at 03:00.",
      "Oxygen supply low. Blood Pressure machine in Bed 2 is faulty. Intensive Care asked for a cot.",
      "Generator failed at 22:00 and power returned at 23:15.",
    ]) expect(patientProblem(t, known, people)).toBeNull();
  });

  it("blocks a title or relationship followed by a name", () => {
    expect(patientIdentifiers("Mrs Abena is restless", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Baby of Akosua needs feeding", known, people).length).toBeGreaterThan(0);
    expect(patientProblem("Madam Fatima in bed 3 refused food", known, people)).toContain("Madam Fatima");
  });

  it("blocks a patient being named, phone numbers and ID or folder numbers", () => {
    expect(patientIdentifiers("The patient named Kofi is stable", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Call the family on 0241234567", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Call +233 24 123 4567", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("NHIS number 12345678 expired", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Folder no 004521 is missing", known, people).length).toBeGreaterThan(0);
  });

  it("does not let a patient through just because a colleague shares the first name", () => {
    expect(patientIdentifiers("Mr Kofi in bed 3 is better", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Kofi Mensah in bed 3 is better", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Kofi Bawa gave the 02:00 round", known, people)).toEqual([]);
  });

  it("blocks two capitalised words that are not a known ward, shift or colleague", () => {
    expect(patientIdentifiers("Waiting for Kwame Boateng to be collected", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Waiting for Female Ward porter", known, people)).toEqual([]);
  });
});

describe("names in feedback text", () => {
  it("catches a lone common first name but lets a colleague's full name and ordinary phrases through", () => {
    expect(patientIdentifiers("Fatima was rude to me", known, people).length).toBeGreaterThan(0);
    expect(patientIdentifiers("Please ask Kofi Bawa to check the Roster Page", known, people)).toEqual([]);
    expect(patientIdentifiers("The Roster Page is slow and Please Call me back", known, people)).toEqual([]);
  });

  it("lets the writer confirm a guess about a name, but never a phone number or a named patient", () => {
    expect(patientCheck("Fatima was rude to me", known, people)?.canConfirm).toBe(true);
    expect(patientCheck("Call 0241234567", known, people)?.canConfirm).toBe(false);
    expect(patientCheck("The patient named Kofi is stable", known, people)?.canConfirm).toBe(false);
    expect(patientCheck("Swaps are easy now.", known, people)).toBeNull();
  });
});

// Annual leave by staff grade, from the Ghana Civil Service conditions of service:
// by category: C (senior staff) 36 working days a year, D (intermediate) 28, E (junior) 21. Categories A and B are directors and are set by hand.
// The Labour Act's floor for anyone is 15.
// A person with no figure set for the year is given their grade's days; a figure set by hand wins.
export const GRADE_DAYS: Record<string, number> = { SENIOR: 36, INTERMEDIATE: 28, JUNIOR: 21 };
export const defaultAnnualDays = (grade: string | null | undefined): number | null => (grade ? GRADE_DAYS[grade] ?? null : null);

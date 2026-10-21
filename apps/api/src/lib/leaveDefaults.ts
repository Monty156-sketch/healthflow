// Annual leave by staff grade, from the Ghana Civil Service conditions of service:
// senior staff 36 working days a year, junior staff 28. The Labour Act's floor for anyone is 15.
// A person with no figure set for the year is given their grade's days; a figure set by hand wins.
export const GRADE_DAYS: Record<string, number> = { SENIOR: 36, JUNIOR: 28 };
export const defaultAnnualDays = (grade: string | null | undefined): number | null => (grade ? GRADE_DAYS[grade] ?? null : null);

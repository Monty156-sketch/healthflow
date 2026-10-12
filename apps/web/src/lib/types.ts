// Shapes the facility API returns.

export interface GroupRef {
  id: string;
  name: string;
  code: string | null;
}

export interface Staff {
  id: string;
  staffNo: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  cadre: GroupRef | null;
  department: GroupRef | null;
  position: string | null;
  employmentStatus: string;
  status: string;
  dateJoined: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  excludedFromNights: boolean;
  exclusionReason: string | null;
  maxDutiesPerWeek: number;
  account: { role: string; active: boolean; lastSignInAt: string | null; mfaEnabled: boolean } | null;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  staffCount: number;
}

export interface Cadre extends Department {
  sortOrder: number;
}

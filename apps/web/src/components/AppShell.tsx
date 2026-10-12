"use client";

// The frame around every signed-in screen: navigation (a sidebar on wide
// screens, a menu on phones), who is signed in, the offline banner, and the
// facility the screens are about. Also the gate: no user, back to sign in.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import { useResource } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { ROLE } from "@/lib/format";
import { Button, Loading, LoadError, Notice } from "@/components/ui";
import { ErrorCapture, ReportProblem } from "@/components/ReportProblem";

// ------------------------------------------------------------- facility context

export interface Facility {
  id: string;
  name: string;
  facilityType: string;
  ghsFacilityCode: string | null;
  region: string | null;
  subDistrict: string | null;
  weekStartsOn: number;
  referencePeriodWeeks: number;
  leaveYearStartMonth: number;
  allowNegativeLeaveBalance: boolean;
  attendanceCutoffDays: number;
  swapCutoffHours: number;
  dpcRegistrationNumber: string | null;
  dpcRegistrationExpiry: string | null;
  dataProtectionContactName: string | null;
  dataProtectionContactEmail: string | null;
  status: string;
}

interface FacilityResponse {
  facility: Facility;
  setup: { departments: number; cadres: number; staff: number };
  me: { role: string; displayName: string };
}

interface FacilityContextValue extends FacilityResponse {
  isAdmin: boolean;
  reload: () => void;
}

const FacilityContext = createContext<FacilityContextValue | null>(null);

/** For facility screens: the signed-in person's facility. */
export function useFacility() {
  const ctx = useContext(FacilityContext);
  if (!ctx) throw new Error("useFacility is only for facility screens");
  return ctx;
}

/** Null for people without facility screens (platform admins, staff). */
export function useOptionalFacility() {
  return useContext(FacilityContext);
}

// ------------------------------------------------------------- navigation

const READ_ROLES = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"];
const PLATFORM = ["PLATFORM_ADMIN"];

const NAV: { href: string; label: string; roles: string[] }[] = [
  { href: "/dashboard", label: "Overview", roles: READ_ROLES },
  { href: "/roster", label: "Roster", roles: READ_ROLES },
  { href: "/staff", label: "Staff", roles: READ_ROLES },
  { href: "/departments-and-cadres", label: "Departments and cadres", roles: READ_ROLES },
  { href: "/shifts", label: "Shifts", roles: READ_ROLES },
  { href: "/duty-cycles", label: "Duty cycles", roles: READ_ROLES },
  { href: "/rules", label: "Compliance rules", roles: READ_ROLES },
  { href: "/settings", label: "Facility settings", roles: ["FACILITY_ADMIN"] },
  { href: "/privacy-and-data", label: "Privacy and data protection", roles: ["FACILITY_ADMIN"] },
  { href: "/audit-log", label: "Audit log", roles: ["FACILITY_ADMIN"] },
  { href: "/system-health", label: "System health", roles: PLATFORM },
];

function NavLinks({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {NAV.filter((n) => n.roles.includes(role)).map((n) => {
        const current = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-[var(--radius)] px-3 text-[15px] ${
                current
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]"
                  : "text-[var(--foreground)] hover:bg-[var(--accent-soft)]"
              }`}
              style={current ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
            >
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------- offline banner

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
  if (online) return null;
  return (
    <div role="status" className="border-b border-[var(--status-warning)] bg-[var(--status-warning-soft)] px-4 py-2 text-sm">
      You are offline. Changes will not be saved until the connection returns.
    </div>
  );
}

// ------------------------------------------------------------- shell

function Brand() {
  return (
    <Link href="/dashboard" className="flex min-h-11 items-center gap-2 font-semibold">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon.svg" alt="" width={22} height={22} />
      HealthFlow
    </Link>
  );
}

function AccountBlock({
  name,
  role,
  onSignOut,
  onNavigate,
}: {
  name: string;
  role: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = pathname === "/account";
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <p className="truncate text-sm font-medium" title={name}>
        {name}
      </p>
      <p className="text-sm text-[var(--muted)]">{ROLE[role] ?? role}</p>
      <div className="mt-1 flex flex-wrap gap-x-1">
        <Link
          href="/account"
          onClick={onNavigate}
          aria-current={current ? "page" : undefined}
          className={`-ml-3 inline-flex min-h-11 items-center rounded-[var(--radius)] px-3 text-sm font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)] ${
            current ? "bg-[var(--accent-soft)]" : ""
          }`}
        >
          My account
        </Link>
        <Button variant="quiet" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
      <div className="flex flex-wrap">
        <ReportProblem />
      </div>
      <p className="figures mt-2 text-[12px] text-[var(--muted)]">Build {process.env.NEXT_PUBLIC_BUILD}</p>
    </div>
  );
}

/** Shown on the home screen to signed-in people who have no facility screens yet. */
export function NoFacilityNotice({ role }: { role: string }) {
  const message =
    role === "PLATFORM_ADMIN"
      ? "You are signed in as a platform admin. Facility data is reached only through a logged support session, which arrives with the platform console in a later phase."
      : role === "STAFF"
        ? "Your own screens, such as today's duty and your roster, arrive in a later phase."
        : "This account has no facility screens yet.";
  return (
    <>
      <h1 className="text-[22px] font-semibold">Signed in</h1>
      <p className="mt-2 max-w-[60ch] text-[var(--muted)]">{message}</p>
      <p className="mt-4">
        <Link href="/account" className="inline-flex min-h-11 items-center font-medium text-[var(--accent-text)] underline-offset-4 hover:underline">
          Manage your account and sign-in security
        </Link>
      </p>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Close the phone menu when the page changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const facilityRole = user && READ_ROLES.includes(user.role);
  const resource = useResource<FacilityResponse>(facilityRole ? "/api/facility" : null);

  if (authLoading || !user) {
    return (
      <main id="main" className="px-4">
        <Loading />
      </main>
    );
  }

  if (facilityRole && resource.error && !resource.data) {
    const denied = resource.error instanceof ApiError && resource.error.status === 403;
    if (!denied) {
      return (
        <main id="main" className="mx-auto max-w-xl px-4 py-16">
          <LoadError message="Your facility could not be loaded. Check your connection and try again." onRetry={resource.reload} />
        </main>
      );
    }
  }
  if (facilityRole && !resource.data && !resource.error) {
    return (
      <main id="main" className="px-4">
        <Loading label="Loading your facility" />
      </main>
    );
  }

  const data = facilityRole ? resource.data : null;
  const ctx: FacilityContextValue | null = data
    ? { ...data, isAdmin: data.me.role === "FACILITY_ADMIN", reload: resource.reload }
    : null;
  const role = data?.me.role ?? user.role;
  const name = data?.me.displayName ?? user.email;
  const facilityName = data?.facility.name;

  return (
    <FacilityContext.Provider value={ctx}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius)] focus:bg-[var(--surface)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="no-print">
        <ErrorCapture />
        <OfflineBanner />
      </div>
      <div className="app-frame lg:grid lg:min-h-screen lg:grid-cols-[15.5rem_1fr]">
        {/* Wide screens: a fixed sidebar. */}
        <aside className="no-print hidden border-r border-[var(--border)] bg-[var(--surface)] lg:flex lg:flex-col lg:gap-6 lg:px-4 lg:py-5">
          <Brand />
          {facilityName && (
            <div>
              <p className="px-3 text-sm text-[var(--muted)]">Facility</p>
              <p className="px-3 font-medium leading-snug">{facilityName}</p>
            </div>
          )}
          <nav aria-label="Main">
            <NavLinks role={role} />
          </nav>
          <div className="mt-auto">
            <AccountBlock name={name} role={role} onSignOut={logout} />
          </div>
        </aside>

        {/* Phones and tablets: a top bar with a menu. */}
        <header className="no-print sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4">
            <Brand />
            <Button
              variant="secondary"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? "Close menu" : "Menu"}
            </Button>
          </div>
          {menuOpen && (
            <div id="mobile-menu" className="border-t border-[var(--border)] px-4 pt-3 pb-4">
              {facilityName && <p className="px-3 pb-2 text-sm text-[var(--muted)]">{facilityName}</p>}
              <nav aria-label="Main">
                <NavLinks role={role} onNavigate={() => setMenuOpen(false)} />
              </nav>
              <div className="mt-3">
                <AccountBlock name={name} role={role} onSignOut={logout} onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
          )}
        </header>

        <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-[72rem]">
            {data?.facility.status === "SUSPENDED" && (
              <div className="mb-4">
                <Notice tone="warning">This facility&apos;s account is suspended. Contact PS Tech.</Notice>
              </div>
            )}
            {ctx || pathname === "/account" || (role === "PLATFORM_ADMIN" && pathname === "/system-health") ? children : <NoFacilityNotice role={role} />}
          </div>
        </main>
      </div>
    </FacilityContext.Provider>
  );
}

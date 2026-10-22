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
import { ROLE, showDate } from "@/lib/format";
import { Button, Loading, LoadError, Notice } from "@/components/ui";
import { getSupport, setSupport } from "@/lib/supportSession";
import { SectionTabs } from "@/components/SectionTabs";
import { sectionFor } from "@/lib/sections";
import { PlatformNotices } from "@/components/PlatformNotices";
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
  /** Hospitals keep one roster per ward or department. */
  rosterByWard?: boolean;
}

interface FacilityResponse {
  facility: Facility;
  setup: { departments: number; cadres: number; staff: number };
  me: { role: string; displayName: string; departmentId?: string | null };
  /** Feature flags that exist, as key to on or off for this facility. A capability with no flag is on. */
  flags?: Record<string, boolean>;
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

const NAV: { href: string; label: string; roles: string[]; flag?: string; section?: string; wards?: boolean; listed?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", roles: READ_ROLES },
  { href: "/roster", label: "Roster", roles: READ_ROLES },
  { href: "/staff", label: "Staff", roles: READ_ROLES },
  { href: "/transfers", label: "Ward transfers", roles: READ_ROLES, wards: true },
  { href: "/in-charges", label: "In-charges", roles: ["FACILITY_ADMIN"], listed: true },
  { href: "/today", label: "Today", roles: ["STAFF"] },
  { href: "/my-duties", label: "Duties", roles: [...READ_ROLES, "STAFF"], section: "duties" },
  { href: "/leave", label: "Leave", roles: [...READ_ROLES, "STAFF"], section: "leave" },
  { href: "/returns", label: "Returns due", roles: READ_ROLES },
  { href: "/coverage", label: "Coverage", roles: READ_ROLES },
  { href: "/reports/fairness", label: "Why this duty", roles: ["STAFF"] },
  { href: "/my-data", label: "My data", roles: ["STAFF"] },
  { href: "/attendance", label: "Attendance", roles: READ_ROLES, section: "attendance" },
  { href: "/my-reports", label: "Reports I sent", roles: [...READ_ROLES, "STAFF"] },
  { href: "/departments-and-cadres", label: "Departments and cadres", roles: READ_ROLES },
  { href: "/duty-patterns", label: "Duty patterns", roles: READ_ROLES },
  { href: "/rules", label: "Compliance rules", roles: ["ROSTER_MANAGER", "SUPERVISOR"], section: "settings" },
  { href: "/settings", label: "Facility settings", roles: ["FACILITY_ADMIN"], section: "settings" },
  { href: "/billing", label: "Billing", roles: ["FACILITY_ADMIN"] },
];

function IconLink({ href, label, active, children, badge }: { href: string; label: string; active: boolean; children: ReactNode; badge?: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex size-11 items-center justify-center rounded-[var(--radius)] text-[var(--foreground)] hover:bg-[var(--accent-soft)] ${active ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {badge}
    </Link>
  );
}

function BellBadge() {
  const { data } = useResource<{ unread: number }>("/api/facility/notifications/count");
  if (!data || data.unread === 0) return null;
  return (
    <span className="figures absolute top-1 right-0.5 min-w-[1.25rem] rounded-[4px] bg-[var(--gold)] px-1 text-center text-[12px] leading-5 font-semibold text-[var(--ink)]">
      {data.unread > 99 ? "99+" : data.unread}
      <span className="sr-only"> unread notifications</span>
    </span>
  );
}

/** The bell and the Reports link, kept out of the sidebar. */
function HeaderActions({ role }: { role: string }) {
  const pathname = usePathname();
  const on = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  const reports = READ_ROLES.includes(role);
  return (
    <div className="flex items-center gap-1">
      {reports && (
        <IconLink href="/reports" label="Reports" active={on("/reports")}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </IconLink>
      )}
      <IconLink href="/notifications" label="Notifications" active={on("/notifications")} badge={<BellBadge />}>
        <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0" />
      </IconLink>
    </div>
  );
}

function NavLinks({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const fac = useOptionalFacility();
  const flags = fac?.flags;
  const items = NAV.filter((n) => n.roles.includes(role) && !(n.flag && flags?.[n.flag] === false) && !(n.wards && !fac?.facility.rosterByWard) && !(n.listed && ["CHPS_COMPOUND", "HEALTH_CENTRE", "CLINIC"].includes(fac?.facility.facilityType ?? "")));
  if (items.length === 0) return null;
  const sec = sectionFor(pathname)?.section.id;
  return (
    <ul className="space-y-0.5">
      {items.map((n) => {
        const longer = NAV.some((o) => o.href.length > n.href.length && o.href.startsWith(`${n.href}/`) && (pathname === o.href || pathname.startsWith(`${o.href}/`)));
        const current = sec ? n.section === sec : !longer && (pathname === n.href || pathname.startsWith(`${n.href}/`));
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-[var(--radius)] px-3 text-[15px] ${
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

function Brand({ area }: { area: Area }) {
  const href = area === "platform" ? "/platform" : area === "district" ? "/district" : "/dashboard";
  return (
    <Link href={href} className="flex min-h-11 items-center gap-2.5 font-semibold">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon.svg" alt="" width={26} height={26} />
      <span className="leading-tight">
        HealthFlow
        {area !== "facility" && <span className="block text-[13px] font-normal text-[var(--muted)]">{area === "platform" ? "Platform console" : "District directorate"}</span>}
      </span>
    </Link>
  );
}

type Area = "facility" | "platform" | "district";

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
      ? "You are signed in as a platform admin. Facility data is reached only through a logged support session. The console is in the menu."
      : role === "STAFF"
        ? "Your duties, leave requests and notifications are in the menu."
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

interface Access {
  status: string;
  locked: boolean;
  canPay: boolean;
  note: string | null;
  endsOn: string | null;
  kind: "trial" | "subscription";
  daysLeft: number | null;
  reminder: boolean;
}

const dayWord = (n: number) => (n === 1 ? "tomorrow" : `in ${n} days`);

/** What a person sees while their facility is waiting for approval, declined, or unpaid. Only the bills page is open, to the administrator. */
function LockedScreen({ access, facility, onSignOut, children }: { access: Access; facility: string | undefined; onSignOut: () => void; children: ReactNode }) {
  const pathname = usePathname();
  const onBilling = pathname === "/billing";
  const lapsed = access.status === "LAPSED";
  const head =
    access.status === "PENDING" ? "Waiting for approval"
    : access.status === "SUSPENDED" ? "Account suspended"
    : access.status === "DECLINED" ? "Registration not approved"
    : access.canPay ? "Payment is due" : "Access is paused";
  const text =
    access.status === "PENDING" ? "PS Tech checks each new facility before it opens. We may telephone you. You will get an email as soon as it is approved, and your trial starts then. Questions: 055 457 1800."
    : access.status === "SUSPENDED" ? `${access.note ?? "This facility's account has been suspended."} Contact PS Tech on 055 457 1800 to have it reinstated.`
    : access.status === "DECLINED" ? `${access.note ?? "This registration was not approved."} If this is a mistake, call PS Tech on 055 457 1800.`
    : access.canPay ? `Your ${access.kind === "trial" ? "trial" : "paid month"}${access.endsOn ? ` ended on ${showDate(access.endsOn)}` : " has ended"}. Pay the bill below and HealthFlow opens again for you and your staff straight away.`
    : "HealthFlow is paused for this facility because its bill has not been paid. Ask your facility administrator to pay it. Access returns as soon as it is paid.";
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Brand area="facility" />
        <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
      </div>
      {facility && <p className="text-sm text-[var(--muted)]">{facility}</p>}
      <h1 className="mt-1 text-2xl font-semibold">{head}</h1>
      <div className="mt-3 mb-6"><Notice tone="warning">{text}</Notice></div>
      {lapsed && access.canPay && (onBilling ? children : <Link href="/billing" className="inline-flex min-h-11 items-center rounded-[var(--radius)] bg-[var(--accent)] px-4 font-medium text-[var(--on-accent)]">Go to the bills page</Link>)}
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const [support, setSupportState] = useState(getSupport);
  const supporting = user?.role === "PLATFORM_ADMIN" && support !== null;

  useEffect(() => {
    if (!authLoading && !user) router.replace(pathname === "/platform" || pathname.startsWith("/platform/") ? "/platform/login" : pathname === "/district" || pathname.startsWith("/district/") ? "/district/login" : "/login");
    // The platform console is where a platform admin starts, unless acting inside a facility.
    if (user?.role === "PLATFORM_ADMIN" && pathname === "/dashboard" && !supporting) router.replace("/platform");
    if (user?.role === "STAFF" && pathname === "/dashboard") router.replace("/today");
    if (user?.role === "DISTRICT_OFFICER" && pathname === "/dashboard") router.replace("/district");
  }, [authLoading, user, router, pathname, supporting]);

  // Close the phone menu when the page changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const facilityRole = user && (READ_ROLES.includes(user.role) || user.role === "STAFF" || supporting);
  const access = useResource<Access>(facilityRole ? "/api/facility/access" : null);
  const locked = Boolean(access.data?.locked) && !supporting;
  const resource = useResource<FacilityResponse>(facilityRole && access.data && !locked ? "/api/facility" : null);
  // A facility that must pay goes straight to its bills.
  const toBills = locked && access.data?.status === "LAPSED" && access.data.canPay && pathname !== "/billing";
  useEffect(() => { if (toBills) router.replace("/billing"); }, [toBills, router]);

  if (authLoading || !user) {
    return (
      <main id="main" className="px-4">
        <Loading />
      </main>
    );
  }

  if (facilityRole && access.error && !access.data) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-16">
        <LoadError message="Your facility could not be loaded. Check your connection and try again." onRetry={access.reload} />
      </main>
    );
  }
  if (facilityRole && !access.data) {
    return (
      <main id="main" className="px-4">
        <Loading label="Loading your facility" />
      </main>
    );
  }
  if (locked && access.data) return <LockedScreen access={access.data} facility={undefined} onSignOut={logout}>{children}</LockedScreen>;

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
  const area: Area =
    user.role === "PLATFORM_ADMIN" && !supporting ? "platform" : user.role === "DISTRICT_OFFICER" ? "district" : "facility";
  const facilityName = data?.facility.name;

  return (
    <FacilityContext.Provider value={ctx}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius)] focus:bg-[var(--surface)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {supporting && support && (
        <div role="status" className="no-print border-b border-[var(--status-warning)] bg-[var(--status-warning-soft)] px-4 py-2 text-sm">
          <span className="font-medium">PS Tech support at {support.facility}.</span>{" "}
          {support.level === "FULL" ? "Full access: changes you make are written to the facility's audit log." : "Read only."} Ends by itself at {new Date(support.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.{" "}
          <button type="button" className="min-h-8 font-medium underline underline-offset-2" onClick={() => { setSupport(null); setSupportState(null); router.push("/platform/support"); }}>Leave facility</button>
        </div>
      )}
      <div className="no-print">
        <ErrorCapture />
        <OfflineBanner />
        {ctx && <PlatformNotices />}
      </div>
      <div className="app-frame lg:grid lg:min-h-screen lg:grid-cols-[15.5rem_1fr]">
        {/* Wide screens: a fixed sidebar. */}
        <aside data-area={area} className="on-ink no-print hidden lg:sticky lg:self-start lg:top-0 lg:flex lg:h-screen lg:flex-col lg:gap-6 lg:overflow-y-auto lg:px-4 lg:py-5">
          <Brand area={area} />
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
        <header data-area={area} className="on-ink no-print sticky top-0 z-30 lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4">
            <Brand area={area} />
            <div className="flex items-center gap-2">
              {ctx && <HeaderActions role={role} />}
            <Button
              variant="secondary"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? "Close menu" : "Menu"}
            </Button>
            </div>
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

        <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-5">
          <div className="mx-auto max-w-[72rem]">
            {ctx && (
              <div className="no-print mb-3 hidden justify-end lg:flex">
                <HeaderActions role={role} />
              </div>
            )}
            {data?.facility.status === "SUSPENDED" && (
              <div className="mb-4">
                <Notice tone="warning">This facility&apos;s account is suspended. Contact PS Tech.</Notice>
              </div>
            )}
            {access.data?.reminder && access.data.endsOn && access.data.daysLeft !== null && (
              <div className="no-print mb-4">
                <Notice tone="warning">
                  The {access.data.kind === "trial" ? "trial" : "paid month"} for this facility ends {dayWord(access.data.daysLeft)} ({showDate(access.data.endsOn)}). If it is not paid by then, HealthFlow closes for everyone until it is.{" "}
                  {access.data.canPay ? <Link href="/billing" className="font-medium underline underline-offset-2">Pay on the Billing page</Link> : "Ask your facility administrator to pay."}
                </Notice>
              </div>
            )}
            <SectionTabs role={role} />
            {ctx || pathname === "/account" || (role === "DISTRICT_OFFICER" && (pathname === "/district" || pathname.startsWith("/district/"))) || (role === "PLATFORM_ADMIN" && (pathname === "/system-health" || pathname === "/platform" || pathname.startsWith("/platform/"))) ? children : <NoFacilityNotice role={role} />}
          </div>
        </main>
      </div>
    </FacilityContext.Provider>
  );
}

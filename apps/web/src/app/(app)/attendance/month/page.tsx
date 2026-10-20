"use client";

import { useMemo, useState } from "react";
import { useResource } from "@/lib/useApi";
import { MONTHS } from "@/lib/format";
import type { AttendanceMonth } from "@/lib/types";
import { GridChip, MonthGrid } from "@/components/MonthGrid";
import { Loading, LoadError, Notice, PageHeader, Select } from "@/components/ui";

const WORDS: Record<string, string> = { P: "Present", LT: "Late", A: "Absent", E: "Excused", OL: "On leave", OD: "Off duty", OA: "Official assignment" };
const COLOUR: Record<string, string> = { P: "#1f7a4d", LT: "#b56b12", A: "#b3261e", E: "#5b6770", OL: "#25619f", OD: "#77878a", OA: "#2f7a8c" };

export default function MonthlyAttendancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dept, setDept] = useState("");
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const { data, error, reload } = useResource<AttendanceMonth>(`/api/facility/attendance/month?month=${key}`);

  const staff = useMemo(() => (data?.staff ?? []).filter((s) => !dept || s.departmentId === dept), [data, dept]);
  const cells = useMemo(() => new Map((data?.cells ?? []).map((c) => [`${c.staffId}|${c.date}`, c])), [data]);
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <>
      <PageHeader title="Monthly attendance" description="P present, LT late, A absent, E excused, OL leave, OD off, OA official. Blank: not recorded." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="am-month" className="mb-1 block text-sm font-medium">Month</label>
          <Select id="am-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="am-year" className="mb-1 block text-sm font-medium">Year</label>
          <Select id="am-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="am-dept" className="mb-1 block text-sm font-medium">Department</label>
          <Select id="am-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {(data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading attendance" />
      ) : !data.published ? (
        <Notice tone="warning">There is no published roster for {MONTHS[month - 1]} {year}, so there is no attendance to show.</Notice>
      ) : (
        <>
          {data.completeness !== null && <p className="figures mb-3 text-[15px]">{Math.round(data.completeness * 100)}% of duties so far this month have attendance recorded.</p>}
          <MonthGrid<{ code: string; review: boolean }>
            year={year}
            month={month}
            staff={staff}
            caption={`Attendance in ${MONTHS[month - 1]} ${year}`}
            cellData={(id, iso) => {
              const c = cells.get(`${id}|${iso}`);
              return c ? { code: c.code, review: Boolean(c.needsReview) } : undefined;
            }}
            renderCell={(c) => <GridChip code={c.code} tone="neutral" colour={COLOUR[c.code]} />}
            describeCell={(c) => `${WORDS[c.code] ?? c.code}${c.review ? ", needs review" : ""}`}
          />
        </>
      )}
    </>
  );
}

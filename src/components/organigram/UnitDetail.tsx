"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { FUNDING, fmt, screenshotUrl } from "@/lib/organigram";
import type { Unit } from "@/types/organigram";

const ORDER = [
  "USG", "ASG", "D-2", "D-1", "P-5", "P-4", "P-3", "P-2/1", "P-2", "P-1",
  "NPO", "NOA", "NOB", "NOC", "NOD", "GS (PL)", "GS (OL)", "FS", "SES", "LL", "SS",
];
function gradeRank(g: string): number {
  const i = ORDER.indexOf(g);
  return i === -1 ? 999 : i;
}

export function UnitDetail({
  unit,
  year,
  onClose,
}: {
  unit: Unit;
  year: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const funds = (["RB", "XB", "OA"] as const).filter((f) => unit.posts[f]);
  const grades = Array.from(
    new Set(Object.values(unit.posts).flatMap((g) => Object.keys(g))),
  ).sort((a, b) => gradeRank(a) - gradeRank(b));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card shadow-xl">
        <div className="sticky top-0 flex items-start justify-between gap-2 border-b bg-card p-4">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              Section {unit.section}
              {unit.panel ? ` · ${unit.panel}` : ""} · {unit.department}
            </div>
            <h2 className="text-lg font-semibold leading-tight text-foreground">{unit.name}</h2>
            {unit.component && (
              <div className="text-sm italic text-muted-foreground">{unit.component}</div>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded p-1 hover:bg-accent">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Total posts </span>
              <span className="font-semibold">{fmt(unit.posts_total)}</span>
            </div>
            {funds.map((f) => (
              <div key={f}>
                <span
                  className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                  style={{ background: FUNDING[f].color }}
                />
                <span className="text-muted-foreground">{f} </span>
                <span className="font-medium">
                  {fmt(f === "RB" ? unit.posts_rb : f === "XB" ? unit.posts_xb : unit.posts_oa)}
                </span>
              </div>
            ))}
          </div>

          {grades.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-1 font-medium">Grade</th>
                  {funds.map((f) => (
                    <th key={f} className="py-1 text-right font-medium">{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g} className="border-b border-muted">
                    <td className="py-1">{g}</td>
                    {funds.map((f) => (
                      <td key={f} className="py-1 text-right tabular-nums">
                        {unit.posts[f]?.[g] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No posts (reporting-line label or committee).
            </p>
          )}

          {unit.parents.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Reports to: </span>
              {unit.parents.join(", ")}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {unit.provenance}
            </span>
            {unit.printed_total != null && unit.printed_total !== unit.posts_total && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                printed total {unit.printed_total}
              </span>
            )}
            {unit.flags.map((fl) => (
              <span key={fl} className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                {fl}
              </span>
            ))}
          </div>

          {unit.screenshot && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Source organigram
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotUrl(year, unit.screenshot)}
                alt={`Source organigram for ${unit.name}`}
                className="w-full rounded border bg-white"
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

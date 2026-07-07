"use client";

import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { PART_SHORT, byPart, fmt, partColor, partColumns, sectionForest, squarify } from "@/lib/organigram";
import { NestedTreemap } from "./NestedTreemap";
import type { Rect, Unit } from "@/types/organigram";
import { useWidth } from "./hooks";

const H = 520;

export function SectionTreemap({ units, onSelectUnit }: { units: Unit[]; onSelectUnit: (u: Unit) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const parts = byPart(units);
  const [drill, setDrill] = useState<{ part: string; section: string } | null>(null);
  const drillSec = drill ? parts.find((p) => p.part === drill.part)?.sections.find((s) => s.section === drill.section) : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
        <button className="hover:text-foreground" onClick={() => setDrill(null)}>All parts</button>
        {drillSec && (<span className="inline-flex items-center gap-1 text-foreground"><ChevronLeft size={14} /> Section {drillSec.section} · {drillSec.department}</span>)}
      </div>
      {drillSec ? (
        <NestedTreemap forest={sectionForest(drillSec.units)} color={partColor(drill!.part)} height={H} onSelectUnit={onSelectUnit} />
      ) : (
      <div ref={ref} className="relative w-full rounded-md bg-muted/30" style={{ height: H }}>
        {/* grouped: part columns (ordered), sections squarified inside each column */}
        {W > 0 && !drill &&
          partColumns(parts, W).map((col, i) => {
            const p = parts[i];
            const color = partColor(p.part);
            const colRect: Rect = { x: 0, y: 0, w: col.w, h: H };
            const wide = col.w > 54;
            return (
              <div key={p.part} className="absolute top-0" style={{ left: col.x, width: col.w, height: H }}>
                {squarify(p.sections.map((s) => ({ value: s.total, data: s })), colRect).map((t) => {
                  const big = t.w > 42 && t.h > 22;
                  return (
                    <button
                      key={t.item.section}
                      onClick={() => setDrill({ part: p.part, section: t.item.section })}
                      title={`Section ${t.item.section} · ${t.item.department} — ${fmt(t.item.total)}`}
                      className="absolute overflow-hidden border border-white/40 px-1 pt-0.5 text-left transition-[filter] hover:brightness-110"
                      style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: color }}
                    >
                      {big && (
                        <span className="pointer-events-none block truncate text-[10px] leading-tight font-semibold text-white">
                          Sect {t.item.section}
                          <span className="block truncate font-normal opacity-85">{fmt(t.item.total)}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* part label strip along the top of the column */}
                {wide && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 truncate bg-black/25 px-1 text-[10px] font-bold text-white">
                    {p.part.replace("Part ", "")} · {PART_SHORT[p.part] ?? p.partName}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      )}
    </div>
  );
}

"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { PART_SHORT, byPart, fmt, partColor, partColumns, sectionForest, squarify } from "@/lib/organigram";
import { NestedTreemap } from "./NestedTreemap";
import type { Rect, Unit } from "@/types/organigram";
import { useWidth } from "./hooks";

const H = 460;

function Box({ r, color, title, sub, onClick }: { r: Rect; color: string; title: string; sub: string; onClick: () => void }) {
  const big = r.w > 46 && r.h > 22;
  return (
    <button
      onClick={onClick}
      title={`${title} — ${sub}`}
      className="absolute overflow-hidden border border-white/40 px-1 pt-0.5 text-left transition-[filter] hover:brightness-110"
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: color }}
    >
      {big && (
        <span className="pointer-events-none block truncate text-[11px] leading-tight font-semibold text-white">
          {title}
          <span className="block truncate text-[10px] font-normal opacity-85">{sub}</span>
        </span>
      )}
    </button>
  );
}

export function DrillTreemap({ units, onSelectUnit }: { units: Unit[]; onSelectUnit: (u: Unit) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const parts = byPart(units);
  const [dp, setDp] = useState<string | null>(null);
  const [ds, setDs] = useState<string | null>(null);
  const part = dp ? parts.find((p) => p.part === dp) : null;
  const section = part && ds ? part.sections.find((s) => s.section === ds) : null;
  const color = part ? partColor(part.part) : "";
  const rect: Rect = { x: 0, y: 0, w: W, h: H };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
        <button className="hover:text-foreground" onClick={() => { setDp(null); setDs(null); }}>All parts</button>
        {part && (<><ChevronRight size={14} /><button className="hover:text-foreground" onClick={() => setDs(null)} style={{ color }}>{part.part} · {PART_SHORT[part.part] ?? part.partName}</button></>)}
        {section && (<><ChevronRight size={14} /><span className="text-foreground">Section {section.section}</span></>)}
      </div>
      {section ? (
        <NestedTreemap forest={sectionForest(section.units)} color={color} height={H} onSelectUnit={onSelectUnit} />
      ) : (
      <div ref={ref} className="relative w-full rounded-md bg-muted/30" style={{ height: H }}>
        {/* level 0: parts as ordered horizontal columns, width proportional to posts */}
        {W > 0 && !part &&
          partColumns(parts, W).map((col, i) => {
            const p = parts[i];
            const wide = col.w > 54;
            return (
              <button
                key={p.part}
                onClick={() => setDp(p.part)}
                title={`${p.part} · ${PART_SHORT[p.part] ?? p.partName} — ${fmt(p.total)} posts`}
                className="absolute top-0 overflow-hidden border border-white/50 px-1 py-1 text-left transition-[filter] hover:brightness-110"
                style={{ left: col.x, width: col.w, height: H, background: partColor(p.part) }}
              >
                <span className="pointer-events-none block text-sm font-bold text-white">{p.part.replace("Part ", "")}</span>
                {wide && (
                  <span className="pointer-events-none mt-0.5 block text-[10px] leading-tight text-white/90">
                    {PART_SHORT[p.part] ?? p.partName}
                    <span className="block text-white/75">{fmt(p.total)} posts</span>
                  </span>
                )}
              </button>
            );
          })}
        {/* level 1: sections of a part (squarified) */}
        {W > 0 && part && !section &&
          squarify(part.sections.map((s) => ({ value: s.total, data: s })), rect).map((t) => (
            <Box key={t.item.section} r={t} color={color} title={`Section ${t.item.section}`} sub={`${t.item.department.slice(0, 38)} · ${fmt(t.item.total)}`} onClick={() => setDs(t.item.section)} />
          ))}
      </div>
      )}
    </div>
  );
}

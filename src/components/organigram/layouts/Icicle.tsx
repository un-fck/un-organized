"use client";

import { useMemo, useState } from "react";
import { PART_SHORT, buildSectionTree, byPart, cmpSection, fmt, partColor } from "@/lib/organigram";
import { cn } from "@/lib/utils";
import type { HNode, SectionAgg, Unit } from "@/types/organigram";
import { useWidth } from "./hooks";

const H = 620;

type Cell = { y: number; h: number; color: string; label: string; sub?: string; onClick: () => void; title: string; active?: boolean };

function Col({ head, cells, grow, empty }: { head: string; cells: Cell[]; grow: number; empty?: string }) {
  return (
    <div className="flex flex-col" style={{ flexGrow: grow, flexBasis: 0 }}>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{head}</div>
      <div className="relative overflow-hidden rounded bg-muted/20" style={{ height: H }}>
        {cells.length === 0 && empty && (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">{empty}</div>
        )}
        {cells.map((c, i) => (
          <button key={i} onClick={c.onClick} title={c.title}
            className={cn("absolute inset-x-0 overflow-hidden border-b border-white/40 px-1 text-left transition-[filter] hover:brightness-110", c.active && "ring-2 ring-inset ring-white")}
            style={{ top: c.y, height: c.h, background: c.color }}>
            {c.h > 12 && (
              <span className="block truncate text-[10px] leading-tight font-medium text-white">
                {c.label}
                {c.sub && c.h > 26 && <span className="block truncate text-[9px] font-normal opacity-85">{c.sub}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function depthOf(n: HNode): number {
  return n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 1;
}
type FCell = { x: number; y: number; w: number; h: number; node: HNode };
function placeFlame(nodes: HNode[], x: number, y0: number, y1: number, colW: number, out: FCell[]) {
  const sum = nodes.reduce((s, n) => s + n.value, 0) || 1;
  let y = y0;
  for (const n of nodes) {
    const h = (n.value / sum) * (y1 - y0);
    out.push({ x: x * colW, y, w: colW, h, node: n });
    if (n.children.length) placeFlame(n.children, x + 1, y, y + h, colW, out);
    y += h;
  }
}

function FlameColumn({ head, forest, color, onSelectUnit }: { head: string; forest: HNode[]; color: string; onSelectUnit: (u: Unit) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const depth = forest.length ? Math.max(...forest.map(depthOf)) : 1;
  const out: FCell[] = [];
  if (w > 0) placeFlame(forest, 0, 0, H, w / depth, out);
  return (
    <div className="flex flex-col" style={{ flexGrow: 6, flexBasis: 0 }}>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{head}</div>
      <div ref={ref} className="relative overflow-hidden rounded bg-muted/20" style={{ height: H }}>
        {out.map((c, i) => (
          <button key={i} onClick={() => c.node.unit && onSelectUnit(c.node.unit)} disabled={!c.node.unit}
            title={`${c.node.name} — ${fmt(c.node.value)} posts`}
            className="absolute overflow-hidden border border-white/40 px-1 text-left transition-[filter] enabled:hover:brightness-110"
            style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: color }}>
            {c.h > 11 && (
              <span className="pointer-events-none block truncate text-[9px] leading-tight font-medium text-white">
                {c.node.name}
                {c.h > 22 && <span className="block text-[8px] font-normal opacity-80">{fmt(c.node.value)}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Icicle({ units, onSelectUnit }: { units: Unit[]; onSelectUnit: (u: Unit) => void }) {
  const parts = useMemo(() => byPart(units), [units]);
  const grand = parts.reduce((s, p) => s + p.total, 0) || 1;
  const [selPart, setSelPart] = useState<string | null>(null);
  const [selSec, setSelSec] = useState<string | null>(null);
  const part = selPart ? parts.find((p) => p.part === selPart) : null;
  const sec = part && selSec ? part.sections.find((s) => s.section === selSec) : null;

  const partCells: Cell[] = [];
  { let y = 0; for (const p of parts) { const h = (p.total / grand) * H; partCells.push({ y, h, color: partColor(p.part), active: p.part === selPart, label: `${p.part.replace("Part ", "")}. ${PART_SHORT[p.part] ?? p.partName}`, sub: `${fmt(p.total)} posts`, title: `${p.part} — ${fmt(p.total)}`, onClick: () => { setSelPart(p.part); setSelSec(null); } }); y += h; } }

  const secCells: Cell[] = [];
  { let y = 0;
    const emit = (list: SectionAgg[], pKey: string, denom: number) => {
      for (const s of [...list].sort((a, b) => cmpSection(a.section, b.section))) {
        const h = (s.total / denom) * H;
        secCells.push({ y, h, color: partColor(pKey), active: pKey === selPart && s.section === selSec, label: `Sect ${s.section}`, sub: s.department.slice(0, 34), title: `Section ${s.section} · ${s.department} — ${fmt(s.total)}`, onClick: () => { setSelPart(pKey); setSelSec(s.section); } });
        y += h;
      }
    };
    if (part) emit(part.sections, part.part, part.total);
    else for (const p of parts) emit(p.sections, p.part, grand);
  }

  return (
    <div>
      <div className="mb-2 text-sm text-muted-foreground">
        Click a part to focus its sections, then a section to see its offices and units nested by reporting line.
        {(selPart || selSec) && (<button className="ml-2 text-un-blue hover:underline" onClick={() => { setSelPart(null); setSelSec(null); }}>reset</button>)}
      </div>
      <div className="flex gap-2">
        <Col head="Budget part" cells={partCells} grow={2} />
        <Col head={part ? `Sections · ${part.part}` : "Sections"} cells={secCells} grow={3} />
        {sec ? (
          <FlameColumn head={`Offices & units · Section ${sec.section}`} forest={buildSectionTree(sec.units)} color={partColor(part!.part)} onSelectUnit={onSelectUnit} />
        ) : (
          <Col head="Offices & units" cells={[]} grow={6} empty="Select a section to see its offices and units, nested by reporting line" />
        )}
      </div>
    </div>
  );
}

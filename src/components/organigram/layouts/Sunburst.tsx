"use client";

import { useMemo, useState } from "react";
import { PART_SHORT, buildSectionTree, byPart, fmt, partColor } from "@/lib/organigram";
import type { HNode, Unit } from "@/types/organigram";

const SIZE = 1440;
const C = SIZE / 2;
const RIN = 120;
const ROUT = 700;
const TAU = Math.PI * 2;

type SNode = {
  key: string;
  name: string;
  value: number;
  color: string;
  unit?: Unit;
  children: SNode[];
  parent?: SNode;
};

function pt(r: number, a: number): [number, number] {
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}
function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const span = Math.min(a1 - a0, TAU - 0.001);
  const b1 = a0 + span;
  const large = span > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, b1), [x2, y2] = pt(r0, b1), [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function Sunburst({ units, onSelectUnit }: { units: Unit[]; onSelectUnit: (u: Unit) => void }) {
  // Build the hierarchy: root → parts → sections → per-panel unit forest (nested).
  const root = useMemo<SNode>(() => {
    const parts = byPart(units);
    const grand = parts.reduce((s, p) => s + p.total, 0) || 1;
    const toS = (h: HNode, color: string, parent: SNode): SNode => {
      const n: SNode = { key: h.key, name: h.name, value: h.value, color, unit: h.unit, children: [], parent };
      n.children = h.children.map((c) => toS(c, color, n));
      return n;
    };
    const rootNode: SNode = { key: "root", name: "All", value: grand, color: "#888", children: [] };
    for (const p of parts) {
      const color = partColor(p.part);
      const partNode: SNode = { key: p.part, name: `${p.part.replace("Part ", "")}. ${PART_SHORT[p.part] ?? p.partName}`, value: p.total, color, children: [], parent: rootNode };
      for (const sec of p.sections) {
        const secNode: SNode = { key: `${p.part}/${sec.section}`, name: `Section ${sec.section} · ${sec.department}`, value: sec.total, color, children: [], parent: partNode };
        secNode.children = buildSectionTree(sec.units).map((office) => toS(office, color, secNode));
        partNode.children.push(secNode);
      }
      rootNode.children.push(partNode);
    }
    return rootNode;
  }, [units]);

  const [focusKey, setFocusKey] = useState("root");
  const focus = useMemo(() => {
    const find = (n: SNode): SNode | null =>
      n.key === focusKey ? n : n.children.reduce<SNode | null>((acc, c) => acc ?? find(c), null);
    return find(root) ?? root;
  }, [root, focusKey]);

  // Lay out the focus subtree into ring segments.
  const { segs, maxRing } = useMemo(() => {
    const segs: { n: SNode; a0: number; a1: number; ring: number }[] = [];
    let maxRing = 0;
    const walk = (n: SNode, a0: number, a1: number, ring: number) => {
      if (ring > 0 || n === focus) {
        if (n !== focus) {
          segs.push({ n, a0, a1, ring: ring - 1 });
          maxRing = Math.max(maxRing, ring - 1);
        }
      }
      const denom = n.value || 1;
      let a = a0;
      for (const c of n.children) {
        const span = (c.value / denom) * (a1 - a0);
        walk(c, a, a + span, ring + 1);
        a += span;
      }
    };
    walk(focus, 0, TAU, 0);
    return { segs, maxRing };
  }, [focus]);

  const thickness = (ROUT - RIN) / (maxRing + 1);
  const onSeg = (n: SNode) => (n.children.length > 0 ? setFocusKey(n.key) : n.unit && onSelectUnit(n.unit));
  const zoomOut = () => focus.parent && setFocusKey(focus.parent.key);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block" style={{ width: "min(92vw, 84vh)", height: "min(92vw, 84vh)" }}>
        {segs.map((s, i) => {
          const r0 = RIN + s.ring * thickness;
          const r1 = r0 + thickness;
          const wide = s.a1 - s.a0 > 0.16 && s.ring < 3;
          const [lx, ly] = pt((r0 + r1) / 2, (s.a0 + s.a1) / 2);
          const label = s.ring === 0 ? s.n.name.replace(/^Section \d+ · /, "") : s.n.name;
          return (
            <g key={i}>
              <path
                d={arcPath(r0, r1, s.a0, s.a1)}
                fill={s.n.color}
                fillOpacity={Math.max(0.35, 1 - s.ring * 0.14)}
                stroke="#fff"
                strokeWidth={0.5}
                style={{ cursor: "pointer" }}
                onClick={() => onSeg(s.n)}
              >
                <title>{`${s.n.name} — ${fmt(s.n.value)} posts`}</title>
              </path>
              {wide && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-white text-[10px] font-semibold">
                  {label.length > 22 ? label.slice(0, 21) + "…" : label}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={C} cy={C} r={RIN - 4} className="fill-card stroke-border" strokeWidth={1} style={{ cursor: focus.parent ? "pointer" : "default" }} onClick={zoomOut} />
        <text x={C} y={C - 8} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-foreground text-sm font-bold">
          {focus.key === "root" ? "All parts" : focus.name.replace(/ · .*/, "").slice(0, 18)}
        </text>
        <text x={C} y={C + 8} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-muted-foreground text-[10px]">
          {fmt(focus.value)} posts
        </text>
        {focus.parent && (
          <text x={C} y={C + 22} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-muted-foreground text-[9px]">↑ zoom out</text>
        )}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">
        Nested by reporting line. Click a segment to zoom in, the centre to zoom out; click a leaf unit for detail.
      </p>
    </div>
  );
}

"use client";

import { fmt, squarify } from "@/lib/organigram";
import type { HNode, Rect, Unit } from "@/types/organigram";
import { useWidth } from "./hooks";

const HEADER = 15;
type NT = { r: Rect; node: HNode; kind: "parent" | "leaf" };

function build(forest: HNode[], rect: Rect, out: NT[]) {
  const items = forest.filter((n) => n.value > 0).map((n) => ({ value: n.value, data: n }));
  for (const t of squarify(items, rect)) {
    const node = t.item;
    if (node.children.length > 0 && t.w > 46 && t.h > HEADER + 18) {
      out.push({ r: t, node, kind: "parent" });
      build(node.children, { x: t.x + 1, y: t.y + HEADER, w: t.w - 2, h: t.h - HEADER - 1 }, out);
    } else {
      out.push({ r: t, node, kind: "leaf" });
    }
  }
}

export function NestedTreemap({
  forest,
  color,
  height,
  onSelectUnit,
}: {
  forest: HNode[];
  color: string;
  height: number;
  onSelectUnit: (u: Unit) => void;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const out: NT[] = [];
  if (w > 0) build(forest, { x: 0, y: 0, w, h: height }, out);
  return (
    <div ref={ref} className="relative w-full rounded-md bg-muted/30" style={{ height }}>
      {out.map((t, i) =>
        t.kind === "parent" ? (
          <div
            key={i}
            className="absolute overflow-hidden border border-white/60"
            style={{ left: t.r.x, top: t.r.y, width: t.r.w, height: t.r.h, background: color }}
            title={`${t.node.name} — ${fmt(t.node.value)} posts (incl. sub-units)`}
          >
            <div
              className="truncate px-1 text-[10px] leading-none font-semibold text-white"
              style={{ height: HEADER, lineHeight: `${HEADER}px`, background: "rgba(0,0,0,0.28)" }}
            >
              {t.node.name} · {fmt(t.node.value)}
            </div>
          </div>
        ) : (
          <button
            key={i}
            onClick={() => t.node.unit && onSelectUnit(t.node.unit)}
            disabled={!t.node.unit}
            title={`${t.node.name} — ${fmt(t.node.value)} posts`}
            className="absolute overflow-hidden border border-white/40 px-1 pt-0.5 text-left transition-[filter] enabled:hover:brightness-110"
            style={{ left: t.r.x, top: t.r.y, width: t.r.w, height: t.r.h, background: color }}
          >
            {t.r.w > 42 && t.r.h > 18 && (
              <span className="pointer-events-none block truncate text-[10px] leading-tight font-medium text-white">
                {t.node.name}
                <span className="block text-[9px] font-normal opacity-85">{fmt(t.node.value)}</span>
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

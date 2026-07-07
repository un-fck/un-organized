"use client";

import { fmt, squarify, subtreeTotal } from "@/lib/organigram";
import type { Rect, TreeNode, Unit } from "@/types/organigram";
import { useWidth } from "./hooks";

const HEADER = 15;
type NT = { r: Rect; node: TreeNode; kind: "parent" | "leaf" };

function build(forest: TreeNode[], rect: Rect, out: NT[]) {
  const items = forest.filter((n) => subtreeTotal(n) > 0).map((n) => ({ value: subtreeTotal(n), data: n }));
  for (const t of squarify(items, rect)) {
    const node = t.item;
    const canNest = node.children.length > 0 && t.w > 46 && t.h > HEADER + 18;
    if (canNest) {
      out.push({ r: t, node, kind: "parent" });
      const inner: Rect = { x: t.x + 1, y: t.y + HEADER, w: t.w - 2, h: t.h - HEADER - 1 };
      const kids: TreeNode[] = [...node.children];
      if (node.unit.posts_total > 0) kids.push({ unit: node.unit, children: [], extraParents: [] });
      build(kids, inner, out);
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
  forest: TreeNode[];
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
            title={`${t.node.unit.name} — ${fmt(subtreeTotal(t.node))} posts (incl. sub-units)`}
          >
            <div
              className="truncate px-1 text-[10px] leading-none font-semibold text-white"
              style={{ height: HEADER, lineHeight: `${HEADER}px`, background: "rgba(0,0,0,0.28)" }}
            >
              {t.node.unit.name} · {fmt(subtreeTotal(t.node))}
            </div>
          </div>
        ) : (
          <button
            key={i}
            onClick={() => onSelectUnit(t.node.unit)}
            title={`${t.node.unit.name} — ${fmt(t.node.unit.posts_total)} posts`}
            className="absolute overflow-hidden border border-white/40 px-1 pt-0.5 text-left transition-[filter] hover:brightness-110"
            style={{ left: t.r.x, top: t.r.y, width: t.r.w, height: t.r.h, background: color }}
          >
            {t.r.w > 42 && t.r.h > 18 && (
              <span className="pointer-events-none block truncate text-[10px] leading-tight font-medium text-white">
                {t.node.unit.name}
                <span className="block text-[9px] font-normal opacity-85">{fmt(t.node.unit.posts_total)}</span>
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

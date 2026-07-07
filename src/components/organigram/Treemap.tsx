"use client";

import { useMemo } from "react";
import { PART_SHORT, byPart, fmt, partColor, squarify } from "@/lib/organigram";
import type { Unit } from "@/types/organigram";

const H = 1200;
const PART_GAP = 2;
const COMPACT = new Set([
  "Part III", "Part VII", "Part IX", "Part X", "Part XI", "Part XIII", "Part XIV",
]);

export function Treemap({
  units,
  onSelectUnit,
}: {
  units: Unit[];
  onSelectUnit: (u: Unit) => void;
}) {
  const parts = useMemo(() => byPart(units), [units]);
  const total = parts.reduce((s, p) => s + p.total, 0) || 1;

  // Part bands: stacked vertically, height proportional to posts, gap between.
  const bands = useMemo(() => {
    const gapPct = (PART_GAP / H) * 100;
    const out: { part: (typeof parts)[number]; startY: number; height: number }[] = [];
    let y = 0;
    parts.forEach((p, i) => {
      const h = (p.total / total) * 100;
      out.push({ part: p, startY: y, height: h });
      y += h + (i < parts.length - 1 ? gapPct : 0);
    });
    return out;
  }, [parts, total]);

  // Right-column label positions, aligned to bands with minimal repulsion for compact ones.
  const labels = useMemo(() => {
    const pos = bands.map((b) => ({ part: b.part.part, y: b.startY }));
    for (let i = 1; i < pos.length; i++) {
      const prevCompact = COMPACT.has(pos[i - 1].part) ? 1.4 : 0;
      if (prevCompact > 0) {
        const bottom = pos[i - 1].y + prevCompact;
        if (pos[i].y < bottom) pos[i].y = bottom + 0.05;
      }
    }
    return pos;
  }, [bands]);

  return (
    <div className="flex flex-col gap-2 lg:flex-row">
      {/* Treemap */}
      <div className="relative w-full overflow-hidden lg:flex-1" style={{ height: H }}>
        {bands.map(({ part, startY, height }) => {
          const color = partColor(part.part);
          const secRects = squarify(
            part.sections.map((s) => ({ value: s.total, data: s })),
            { x: 0, y: 0, w: 100, h: 100 },
          );
          return (
            <div
              key={part.part}
              className="absolute right-0 left-0"
              style={{ top: `${startY}%`, height: `${height}%` }}
            >
              {secRects.map((sr, si) => {
                const unitRects = squarify(
                  sr.item.units.map((u) => ({ value: u.posts_total, data: u })),
                  { x: 0, y: 0, w: 100, h: 100 },
                );
                const dividers = secRects.length > 1 || unitRects.length > 1;
                return (
                  <div
                    key={`${sr.item.section}-${si}`}
                    className="absolute"
                    style={{ left: `${sr.x}%`, top: `${sr.y}%`, width: `${sr.w}%`, height: `${sr.h}%` }}
                  >
                    {unitRects.map((ur) => {
                      const u = ur.item;
                      const pxH = (ur.h / 100) * (sr.h / 100) * (height / 100) * H;
                      const showName = pxH > 15;
                      const showPosts = pxH > 40;
                      return (
                        <button
                          key={u.id}
                          onClick={() => onSelectUnit(u)}
                          title={`${u.name} — ${fmt(u.posts_total)} posts`}
                          className="absolute cursor-pointer overflow-hidden px-0.5 text-left transition-[filter] hover:brightness-110"
                          style={{
                            left: `${ur.x}%`,
                            top: `${ur.y}%`,
                            width: `${ur.w}%`,
                            height: `${ur.h}%`,
                            background: color,
                            boxShadow: dividers ? "inset 0 0 0 0.5px rgba(255,255,255,0.6)" : "none",
                          }}
                        >
                          {showName && (
                            <span className="pointer-events-none block truncate text-[11px] leading-tight font-semibold text-white">
                              {u.name}
                            </span>
                          )}
                          {showPosts && (
                            <span className="pointer-events-none -mt-0.5 block truncate text-[10px] leading-tight text-white/90">
                              {fmt(u.posts_total)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Desktop part labels (right column) */}
      <div className="relative hidden w-60 shrink-0 lg:block" style={{ height: H }}>
        {labels.map((l) => {
          const band = bands.find((b) => b.part.part === l.part)!;
          const color = partColor(l.part);
          const numeral = l.part.replace("Part ", "");
          const name = PART_SHORT[l.part] ?? band.part.partName;
          return COMPACT.has(l.part) ? (
            <div
              key={l.part}
              className="absolute left-0 flex -translate-y-px text-xs leading-none whitespace-nowrap"
              style={{ top: `${l.y}%`, color }}
            >
              <span className="w-6 font-medium">{numeral}.</span>
              <span className="font-medium">{name}</span>
              <span className="ml-3">{fmt(band.part.total)}</span>
            </div>
          ) : (
            <div
              key={l.part}
              className="absolute left-0 flex -translate-y-px text-xs leading-none"
              style={{ top: `${l.y}%`, color }}
            >
              <span className="w-6 font-medium">{numeral}.</span>
              <div className="leading-tight">
                <div className="font-medium">{name}</div>
                <div className="mt-0.5">{fmt(band.part.total)} posts</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

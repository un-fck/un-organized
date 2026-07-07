"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { buildSectionTree, byPart, cmpSection, fmt, partColor } from "@/lib/organigram";
import type { SectionAgg, Unit } from "@/types/organigram";
import { OrgTree } from "./OrgTree";

function SectionRow({ sec, onSelect }: { sec: SectionAgg; onSelect: (u: Unit) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="shrink-0 text-sm font-medium text-foreground">
          Section {sec.section}
        </span>
        <span className="truncate text-sm text-muted-foreground">{sec.department}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {fmt(sec.total)}
        </span>
      </button>
      {open && (
        <div className="p-2 pt-0">
          <OrgTree forest={buildSectionTree(sec.units)} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

export function PartTree({ units, onSelect }: { units: Unit[]; onSelect: (u: Unit) => void }) {
  const parts = useMemo(() => byPart(units), [units]);
  return (
    <div className="space-y-6">
      {parts.map((p) => (
        <section key={p.part}>
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block h-3.5 w-3.5 rounded-sm"
              style={{ background: partColor(p.part) }}
            />
            <h3 className="text-sm font-semibold text-foreground">
              {p.part} · {p.partName}
            </h3>
            <span className="text-xs text-muted-foreground">{fmt(p.total)} posts</span>
          </div>
          <div
            className="space-y-1.5 border-l-2 pl-3"
            style={{ borderColor: partColor(p.part) }}
          >
            {[...p.sections].sort((a, b) => cmpSection(a.section, b.section)).map((s) => (
              <SectionRow key={s.section} sec={s} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

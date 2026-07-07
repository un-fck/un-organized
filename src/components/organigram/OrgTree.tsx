"use client";

import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { useMemo, useState } from "react";
import { FUNDING, buildForest, fmt } from "@/lib/organigram";
import { cn } from "@/lib/utils";
import type { TreeNode, Unit } from "@/types/organigram";

function Bar({ u }: { u: Unit }) {
  const t = u.posts_total || 1;
  return (
    <span className="ml-2 inline-flex h-2 w-16 overflow-hidden rounded-sm bg-muted align-middle">
      {(["RB", "XB", "OA"] as const).map((f) => {
        const v = f === "RB" ? u.posts_rb : f === "XB" ? u.posts_xb : u.posts_oa;
        return v ? (
          <span key={f} style={{ width: `${(v / t) * 100}%`, background: FUNDING[f].color }} />
        ) : null;
      })}
    </span>
  );
}

function Row({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (u: Unit) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent"
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        <button
          onClick={() => hasKids && setOpen((o) => !o)}
          className={cn("shrink-0 text-muted-foreground", !hasKids && "opacity-0")}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button
          onClick={() => onSelect(node.unit)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-sm text-foreground">{node.unit.name}</span>
          {node.extraParents.length > 0 && (
            <GitBranch size={12} className="shrink-0 text-amber-500" aria-label="also reports elsewhere" />
          )}
          <Bar u={node.unit} />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmt(node.unit.posts_total)}
          </span>
        </button>
      </div>
      {open && hasKids && (
        <div>
          {node.children.map((c) => (
            <Row key={c.unit.id} node={c} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgTree({ units, onSelect }: { units: Unit[]; onSelect: (u: Unit) => void }) {
  // group by panel within the section, forest per panel
  const panels = useMemo(() => {
    const map = new Map<string, Unit[]>();
    for (const u of units) {
      const key = u.panel || "-";
      const arr = map.get(key) ?? [];
      arr.push(u);
      map.set(key, arr);
    }
    return [...map.entries()].map(([panel, us]) => ({
      panel,
      heading: us[0].panel_heading,
      forest: buildForest(us),
    }));
  }, [units]);

  return (
    <div className="space-y-4">
      {panels.map((p) => (
        <div key={p.panel} className="rounded-md border bg-card p-2">
          {(p.heading || p.panel !== "-") && (
            <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {p.panel !== "-" ? `${p.panel} ` : ""}
              {p.heading}
            </div>
          )}
          {p.forest.map((n) => (
            <Row key={n.unit.id} node={n} depth={0} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  );
}

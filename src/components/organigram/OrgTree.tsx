"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { FUNDING, fmt } from "@/lib/organigram";
import { cn } from "@/lib/utils";
import type { HNode, Unit } from "@/types/organigram";

function Bar({ u }: { u: Unit }) {
  const t = u.posts_total || 1;
  return (
    <span className="ml-2 inline-flex h-2 w-16 overflow-hidden rounded-sm bg-muted align-middle">
      {(["RB", "XB", "OA"] as const).map((f) => {
        const v = f === "RB" ? u.posts_rb : f === "XB" ? u.posts_xb : u.posts_oa;
        return v ? <span key={f} style={{ width: `${(v / t) * 100}%`, background: FUNDING[f].color }} /> : null;
      })}
    </span>
  );
}

function Row({ node, depth, onSelect }: { node: HNode; depth: number; onSelect: (u: Unit) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const hasKids = node.children.length > 0;
  return (
    <div>
      <div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent" style={{ paddingLeft: depth * 16 + 4 }}>
        <button onClick={() => hasKids && setOpen((o) => !o)} className={cn("shrink-0 text-muted-foreground", !hasKids && "opacity-0")}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button onClick={() => node.unit && onSelect(node.unit)} disabled={!node.unit} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn("truncate text-sm", node.unit ? "text-foreground" : "font-medium text-muted-foreground")}>{node.name}</span>
          {node.unit && <Bar u={node.unit} />}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(node.value)}</span>
        </button>
      </div>
      {open && hasKids && <div>{node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} onSelect={onSelect} />)}</div>}
    </div>
  );
}

export function OrgTree({ forest, onSelect }: { forest: HNode[]; onSelect: (u: Unit) => void }) {
  return (
    <div className="rounded-md border bg-card p-2">
      {forest.map((n) => <Row key={n.key} node={n} depth={0} onSelect={onSelect} />)}
    </div>
  );
}

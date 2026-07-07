import type { PartAgg, Rect, SectionAgg, Tile, TreeNode, Unit } from "@/types/organigram";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function dataUrl(year: number): string {
  return `${basePath}/data/organigrams-${year}.json`;
}
export function screenshotUrl(year: number, file: string): string {
  return `${basePath}/organigrams/${year}/${file}`;
}

// Budget-Part palette (matches the boilerplate theme tokens / budget-explorer).
export const PART_COLORS: Record<string, string> = {
  "Part I": "#009edb",
  "Part II": "#4a7c7e",
  "Part III": "#7d8471",
  "Part IV": "#9b8b7a",
  "Part V": "#a0665c",
  "Part VI": "#6c5b7b",
  "Part VII": "#5a6c7d",
  "Part VIII": "#495057",
  "Part IX": "#969696",
  "Part X": "#33b8e8",
  "Part XI": "#6a9a9c",
  "Part XII": "#9aa390",
  "Part XIII": "#b8a899",
  "Part XIV": "#c08579",
};
export const PART_SHORT: Record<string, string> = {
  "Part I": "Policymaking & Coordination",
  "Part II": "Political Affairs",
  "Part III": "Justice & Law",
  "Part IV": "International Development",
  "Part V": "Regional Development",
  "Part VI": "Human Rights & Humanitarian",
  "Part VII": "Global Communications",
  "Part VIII": "Support Services",
  "Part IX": "Internal Oversight",
  "Part X": "Joint Activities & Special",
  "Part XI": "Capital Expenditure",
  "Part XII": "Safety & Security",
  "Part XIII": "Development Account",
  "Part XIV": "Staff Assessment",
};
export function partColor(part: string): string {
  return PART_COLORS[part] ?? "#495057";
}
const PART_ORDER = Object.keys(PART_COLORS);

export const FUNDING = {
  RB: { label: "Regular budget", color: "#009edb" },
  XB: { label: "Extrabudgetary", color: "#7d8471" },
  OA: { label: "Other assessed", color: "#a0665c" },
} as const;

export function cmpSection(a: string, b: string): number {
  const na = parseInt(a, 10) || 0;
  const nb = parseInt(b, 10) || 0;
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ---- aggregation -----------------------------------------------------------
export function bySection(units: Unit[]): SectionAgg[] {
  const map = new Map<string, SectionAgg>();
  for (const u of units) {
    let a = map.get(u.section);
    if (!a) {
      a = { section: u.section, department: u.department, units: [], total: 0 };
      map.set(u.section, a);
    }
    a.units.push(u);
    a.total += u.posts_total;
  }
  return [...map.values()].sort((x, y) => y.total - x.total);
}

export function byPart(units: Unit[]): PartAgg[] {
  const parts = new Map<string, { partName: string; secs: Map<string, SectionAgg> }>();
  for (const u of units) {
    let p = parts.get(u.part);
    if (!p) {
      p = { partName: u.part_name, secs: new Map() };
      parts.set(u.part, p);
    }
    let s = p.secs.get(u.section);
    if (!s) {
      s = { section: u.section, department: u.department, units: [], total: 0 };
      p.secs.set(u.section, s);
    }
    s.units.push(u);
    s.total += u.posts_total;
  }
  const out: PartAgg[] = [...parts.entries()].map(([part, p]) => {
    const sections = [...p.secs.values()].sort((a, b) => b.total - a.total);
    return { part, partName: p.partName, sections, total: sections.reduce((s, x) => s + x.total, 0) };
  });
  return out.sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
}

// ---- squarified treemap ----------------------------------------------------
function worst(areas: number[], side: number): number {
  const s = areas.reduce((a, b) => a + b, 0);
  if (s === 0) return Infinity;
  const mx = Math.max(...areas);
  const mn = Math.min(...areas);
  return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
}

export function squarify<T>(input: { value: number; data: T }[], rect: Rect): Tile<T>[] {
  const out: Tile<T>[] = [];
  const nodes = input.filter((n) => n.value > 0).sort((a, b) => b.value - a.value);
  if (!nodes.length) return out;
  const total = nodes.reduce((s, n) => s + n.value, 0);
  const scale = (rect.w * rect.h) / total;
  const areas = nodes.map((n) => ({ data: n.data, area: n.value * scale }));

  let r: Rect = { ...rect };
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(r.w, r.h);
    const row: { data: T; area: number }[] = [];
    let rowAreas: number[] = [];
    while (i < areas.length) {
      const next = [...rowAreas, areas[i].area];
      if (row.length === 0 || worst(next, side) <= worst(rowAreas, side)) {
        row.push(areas[i]);
        rowAreas = next;
        i++;
      } else break;
    }
    const rowSum = rowAreas.reduce((a, b) => a + b, 0);
    if (r.w >= r.h) {
      const colW = rowSum / r.h;
      let y = r.y;
      for (const a of row) {
        const h = a.area / colW;
        out.push({ x: r.x, y, w: colW, h, item: a.data });
        y += h;
      }
      r = { x: r.x + colW, y: r.y, w: r.w - colW, h: r.h };
    } else {
      const rowH = rowSum / r.w;
      let x = r.x;
      for (const a of row) {
        const w = a.area / rowH;
        out.push({ x, y: r.y, w, h: rowH, item: a.data });
        x += w;
      }
      r = { x: r.x, y: r.y + rowH, w: r.w, h: r.h - rowH };
    }
  }
  return out;
}

export function partColumns(
  items: { total: number }[],
  width: number,
  gap = 3,
  minW = 10,
): { x: number; w: number }[] {
  const grand = items.reduce((a, b) => a + b.total, 0) || 1;
  const avail = Math.max(0, width - gap * (items.length - 1));
  let ws = items.map((it) => Math.max(minW, (it.total / grand) * avail));
  const scale = avail / (ws.reduce((a, b) => a + b, 0) || 1);
  ws = ws.map((w) => w * scale);
  const out: { x: number; w: number }[] = [];
  let x = 0;
  ws.forEach((w) => {
    out.push({ x, w });
    x += w + gap;
  });
  return out;
}

export function pad(r: Rect, p: number): Rect {
  return { x: r.x + p, y: r.y + p, w: Math.max(0, r.w - 2 * p), h: Math.max(0, r.h - 2 * p) };
}

// ---- hierarchy (per section) ----------------------------------------------
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function buildForest(units: Unit[]): TreeNode[] {
  const byName = new Map<string, Unit>();
  units.forEach((u) => byName.set(norm(u.name), u));
  const childrenOf = new Map<string, Unit[]>();
  const roots: Unit[] = [];
  const firstParent = new Map<string, string>();

  for (const u of units) {
    const ps = u.parents.map(norm).filter((p) => byName.has(p) && p !== norm(u.name));
    if (ps.length === 0) {
      roots.push(u);
    } else {
      firstParent.set(u.id, ps[0]);
      const arr = childrenOf.get(ps[0]) ?? [];
      arr.push(u);
      childrenOf.set(ps[0], arr);
    }
  }

  const seen = new Set<string>();
  const build = (u: Unit): TreeNode => {
    seen.add(u.id);
    const kids = (childrenOf.get(norm(u.name)) ?? []).filter((c) => !seen.has(c.id));
    const extra = u.parents
      .map(norm)
      .filter((p) => byName.has(p) && p !== firstParent.get(u.id) && p !== norm(u.name));
    return {
      unit: u,
      extraParents: extra,
      children: kids.map(build).sort((a, b) => b.unit.posts_total - a.unit.posts_total),
    };
  };
  const forest = roots.map(build);
  for (const u of units) if (!seen.has(u.id)) forest.push(build(u));
  return forest.sort((a, b) => b.unit.posts_total - a.unit.posts_total);
}

// A section spans several panels (separate charts); build a first-parent forest per
// panel (names only collide within a chart) and concatenate. 99% of units are pure
// tree; the ~1% with multiple parents attach to their first in-panel parent.
export function sectionForest(units: Unit[]): TreeNode[] {
  const byPanel = new Map<string, Unit[]>();
  for (const u of units) {
    const k = u.panel ?? "-";
    const arr = byPanel.get(k) ?? [];
    arr.push(u);
    byPanel.set(k, arr);
  }
  return [...byPanel.values()].flatMap(buildForest);
}

export function subtreeTotal(n: TreeNode): number {
  return n.unit.posts_total + n.children.reduce((s, c) => s + subtreeTotal(c), 0);
}

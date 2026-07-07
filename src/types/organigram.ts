export interface Unit {
  id: string;
  year: number;
  section: string;
  part: string;
  part_name: string;
  department: string;
  panel: string | null;
  panel_heading: string | null;
  encoding: string;
  name: string;
  component: string | null;
  parents: string[];
  posts: Record<string, Record<string, number>>; // fund -> grade -> count
  posts_total: number;
  posts_rb: number;
  posts_xb: number;
  posts_oa: number;
  printed_total: number | null;
  provenance: string;
  flags: string[];
  screenshot: string | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

export interface SectionAgg {
  section: string;
  department: string;
  units: Unit[];
  total: number;
}

export interface PartAgg {
  part: string;
  partName: string;
  sections: SectionAgg[];
  total: number;
}

export interface TreeNode {
  unit: Unit;
  children: TreeNode[];
  extraParents: string[];
}

// Unified hierarchy node for the plots: an office/panel grouping (no `unit`) or a
// real unit (leaf or internal). `value` is the subtree total posts.
export interface HNode {
  key: string;
  name: string;
  value: number;
  unit?: Unit;
  children: HNode[];
}

"""Stage D-export: flatten merged organigram data into the webapp dataset.

Reads `data/processed/ppb{year}/organigrams/merged/*.json` (Stage B + Stage C' output)
and produces, for the explorer app:

* `public/data/organigrams-{year}.json` -- a flat array of unit rows (clean snake_case
  fields; hierarchy is reconstructed in the app from `parents`).
* `public/organigrams/{year}/*.png`      -- one source screenshot per panel (rendered PDF
  page for native/table/unresolved, embedded bitmap for raster), referenced by each unit.

Run from `python/`:  python d_export_webapp.py 2026
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import c_extract_vision as V  # locate_panels / render_page

PROC = Path("../data/processed")
DL = Path("../data/downloads")
WEB = Path("../public")


PART_BY_BASE = {
    1: "I", 2: "I", 3: "II", 4: "II", 5: "II", 6: "II", 7: "III", 8: "III",
    9: "IV", 10: "IV", 11: "IV", 12: "IV", 13: "IV", 14: "IV", 15: "IV", 16: "IV", 17: "IV",
    18: "V", 19: "V", 20: "V", 21: "V", 22: "V", 23: "V",
    24: "VI", 25: "VI", 26: "VI", 27: "VI", 28: "VII", 29: "VIII", 30: "IX",
    31: "X", 32: "X", 33: "XI", 34: "XII", 35: "XIII", 36: "XIV",
}
PART_NAMES = {
    "I": "Overall policymaking, direction and coordination", "II": "Political affairs",
    "III": "International justice and law", "IV": "International cooperation for development",
    "V": "Regional cooperation for development", "VI": "Human rights and humanitarian affairs",
    "VII": "Global communications", "VIII": "Common support services",
    "IX": "Internal oversight", "X": "Jointly financed activities and special expenses",
    "XI": "Capital expenditure", "XII": "Safety and security",
    "XIII": "Development Account", "XIV": "Staff assessment",
}


def _part_of(section: str) -> tuple[str, str]:
    m = re.match(r"(\d+)", section)
    numeral = PART_BY_BASE.get(int(m.group(1))) if m else None
    if not numeral:
        return ("Part ?", "Unassigned")
    return (f"Part {numeral}", PART_NAMES[numeral])


def _slug(stem: str, panel_label: str | None, idx: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", stem.lower()).strip("_")
    suf = (panel_label or f"p{idx}").rstrip(".")
    return f"{base}_{suf}"


def _canon_grade(g: str) -> str:
    g = re.sub(r"[ª-῿⁰-₟]+$", "", g)     # superscript footnote
    g = re.sub(r"\s*[a-z]$", "", g.strip())                  # plain-letter footnote
    g = re.sub(r"GS\s*\(?([A-Z]{2})\)?", r"GS (\1)", g)      # GS PL -> GS (PL)
    return g.strip()


def _agg_posts(box: dict) -> dict:
    out = {"RB": {}, "XB": {}, "OA": {}}
    for fund, lst in (box.get("posts") or {}).items():
        d = out.setdefault(fund, {})
        for x in lst:
            g = _canon_grade(x["grade"])
            d[g] = d.get(g, 0) + (x.get("count") or 0)
    return {k: v for k, v in out.items() if v}


def export_year(year: int) -> None:
    org = PROC / f"ppb{year}" / "organigrams"
    merged = sorted((org / "merged").glob("*.json"))
    img_out = WEB / "organigrams" / str(year)
    img_out.mkdir(parents=True, exist_ok=True)
    (WEB / "data").mkdir(parents=True, exist_ok=True)

    units = []
    for jf in merged:
        d = json.loads(jf.read_text())
        stem = jf.stem
        pdf = str(DL / f"ppb{year}" / f"{stem}.pdf")
        sec_m = re.search(r"Sect\. ?([0-9]+[A-Z]?)(?:\)_Add\.(\d+))?", stem)
        section = (sec_m.group(1) if sec_m else stem)
        if sec_m and sec_m.group(2):
            section += f"/Add.{sec_m.group(2)}"
        # section/department label = first panel heading if present
        dept = next((p.get("heading") for p in d["panels"] if p.get("heading")), None) or f"Section {section}"

        page_map = None
        for idx, p in enumerate(d["panels"]):
            enc = p["encoding"]
            # resolve a screenshot for this panel
            shot = None
            src_png = None
            if enc == "raster" and p.get("raster_images"):
                cand = org / "media" / p["raster_images"][0]
                if cand.exists():
                    src_png = cand
            elif enc in ("native", "table", "unresolved"):
                if page_map is None:
                    page_map = V.locate_panels(pdf, d["panels"])
                if idx in page_map:
                    cand = org / "pages" / f"{stem}_p{page_map[idx]}.png"
                    if not cand.exists():
                        V.render_page(pdf, page_map[idx], cand)
                    if cand.exists():
                        src_png = cand
            if src_png is not None:
                shot = f"{_slug(stem, p.get('label'), idx)}.png"
                dst = img_out / shot
                if not dst.exists():
                    shutil.copy(src_png, dst)

            m = p.get("merge", {})
            boxes = m.get("boxes", []) if m.get("status") == "ok" else []
            for bi, b in enumerate(boxes):
                posts = _agg_posts(b)
                tot = sum(c for v in posts.values() for c in v.values())
                units.append({
                    "id": f"{year}-{section}-{idx}-{bi}",
                    "year": year,
                    "section": section,
                    "part": _part_of(section)[0],
                    "part_name": _part_of(section)[1],
                    "department": dept,
                    "panel": p.get("label"),
                    "panel_heading": p.get("heading"),
                    "encoding": enc,
                    "name": b.get("name") or "(unnamed)",
                    "component": b.get("component"),
                    "parents": b.get("parents") or [],
                    "posts": posts,
                    "posts_total": tot,
                    "posts_rb": sum(posts.get("RB", {}).values()),
                    "posts_xb": sum(posts.get("XB", {}).values()),
                    "posts_oa": sum(posts.get("OA", {}).values()),
                    "printed_total": b.get("total"),
                    "provenance": "deterministic" if enc in ("native", "table") else "vision",
                    "flags": b.get("flags") or [],
                    "screenshot": shot,
                })

    out = WEB / "data" / f"organigrams-{year}.json"
    out.write_text(json.dumps(units, ensure_ascii=False))
    imgs = len(list(img_out.glob("*.png")))
    print(f"wrote {out} — {len(units)} units, {imgs} screenshots in {img_out}/")
    print(f"sections: {len(set(u['section'] for u in units))}, "
          f"total posts: {sum(u['posts_total'] for u in units)}")


if __name__ == "__main__":
    export_year(int(sys.argv[1]) if len(sys.argv) > 1 else 2026)

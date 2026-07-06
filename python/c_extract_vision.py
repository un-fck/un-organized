"""Stage C': vision extraction + hierarchy for organigrams, layered on Stage B.

Stage B (`b_extract_organigrams.py`) extracts native/table charts deterministically
(exact, checksummed post counts) but has no hierarchy, and leaves raster/unresolved
panels with no boxes at all. This stage reads each chart's *image* with Azure OpenAI
(vision + strict structured outputs) and produces, per panel, a merged record:

* native / table  -> Stage B posts are authoritative; vision supplies ``parents``
                     (hierarchy) and a cross-check on the posts.
* raster          -> the extracted bitmap is read by vision (sole source).
* unresolved      -> the rendered PDF page is read by vision (sole source).

Panels are matched to their PDF page by :func:`locate_panels` (heading text + box-name
overlap within the annex region). Vision calls run concurrently via a thread pool.

Requires the ``openai`` SDK and, in ``.env``: ``AZURE_OPENAI_ENDPOINT``,
``AZURE_OPENAI_API_KEY``, ``AZURE_OPENAI_API_VERSION``. Deployment from
``AZURE_OPENAI_DEPLOYMENT`` (default ``gpt-5.4``).

    python c_extract_vision.py run 2026          # full year
    python c_extract_vision.py run 2026 "Sect. 2"  # one section (substring filter)
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()
DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5.4")
WORKERS = int(os.getenv("VISION_WORKERS", "8"))
PROC = Path("../data/processed")
DL = Path("../data/downloads")

# --- extraction schema (strict structured outputs) ----------------------------
_POST = {"type": "object", "properties": {"count": {"type": "integer"}, "grade": {"type": "string"}},
         "required": ["count", "grade"], "additionalProperties": False}
_FUNDS = {"type": "object", "properties": {k: {"type": "array", "items": _POST} for k in ("RB", "XB", "OA")},
          "required": ["RB", "XB", "OA"], "additionalProperties": False}
BOX_SCHEMA = {
    "type": "object",
    "properties": {
        "panel_title": {"type": ["string", "null"]},
        "boxes": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "component": {"type": ["string", "null"]},
                "posts": _FUNDS,
                "total": {"type": ["integer", "null"]},
                "parents": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "component", "posts", "total", "parents"],
            "additionalProperties": False,
        }},
    },
    "required": ["panel_title", "boxes"],
    "additionalProperties": False,
}

PROMPT = """\
You are extracting structured data from a single UN organizational chart (organigram) image.

The chart is a set of boxes connected by lines. Each box contains:
- a bold unit name (may span multiple lines);
- optionally an italic parenthetical tag naming a component or subprogramme, e.g.
  "(subprogramme 3)", "(programme support)", "(executive direction and management)";
- a table of authorized posts split across funding sources shown as column headers:
  RB (regular budget), XB (extrabudgetary), OA (other assessed). Under each header, posts
  are listed as "<count> <grade>" where grade is one of USG, ASG, D-2, D-1, P-5, P-4, P-3,
  P-2/1, P-2, P-1, GS (PL), GS (OL), LL, NPO, NOA..NOD, FS, SES;
- optionally per-column subtotal numbers and a combined "Total: N";
- footnote superscript letters (a, b, ...) may follow a grade or the name.

Some boxes (e.g. "Secretary-General", "Chef de Cabinet") are reporting-line labels with no
posts -- include them with empty post lists.

Transcribe post counts and grades EXACTLY as printed. Do NOT infer or fill in missing numbers.
Only populate a funding key (RB/XB/OA) when that column is present in a box; use [] otherwise.
Set "parents" to the list of box names this box connects upward to via the connector lines.
A box may have MORE than one parent (joint/matrix structures connect a unit to several
superior offices) -- include every one. Use [] for a top-level box with no parent. A box
drawn nested inside another box has that enclosing box as its parent.

If the image is not an organizational chart (e.g. a resource table or a page of prose),
return an empty boxes list.
"""


# --- client + single call -----------------------------------------------------
def _client():
    from openai import AzureOpenAI
    return AzureOpenAI(azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
                       api_key=os.environ["AZURE_OPENAI_API_KEY"],
                       api_version=os.environ["AZURE_OPENAI_API_VERSION"])


def extract_image(client, image_path: Path) -> dict:
    """GPT vision + strict structured outputs on one organigram image."""
    media = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
    data = base64.standard_b64encode(image_path.read_bytes()).decode()
    resp = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:{media};base64,{data}", "detail": "high"}}]}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "organigram", "schema": BOX_SCHEMA, "strict": True}},
        max_completion_tokens=16000)
    return json.loads(resp.choices[0].message.content)


# --- panel -> PDF page locator ------------------------------------------------
def _page_texts(pdf: str) -> list[str]:
    return subprocess.run(["pdftotext", "-layout", pdf, "-"],
                          capture_output=True, text=True).stdout.split("\f")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).lower().strip()


_ANNEX = re.compile(r"(approved o|proposed o|o)rganizational structure and post", re.I)
_REGION_END = re.compile(r"summary of proposed|changes in established and temporary", re.I)


def locate_panels(pdf: str, panels: list) -> dict[int, int]:
    """Map panel index -> 1-based PDF page via heading text + box-name overlap in the
    annex region (which ends at the post-changes summary, not the annex's own title)."""
    pages = _page_texts(pdf)
    n = len(pages)
    npage = [_norm(p) for p in pages]
    # LAST occurrence: the first is the table-of-contents entry, the annex is near the end
    start = next((i for i in range(n - 1, -1, -1) if _ANNEX.search(pages[i])), n * 2 // 3)
    end = next((i for i in range(start + 1, n) if _REGION_END.search(pages[i])), n)
    out = {}
    for idx, panel in enumerate(panels):
        key = _norm(panel.get("heading") or "")
        names = [_norm(b["name"]) for b in panel.get("boxes", []) if len(b.get("name", "")) > 8]
        if not key and names:
            key = names[0]
        best, best_score = None, 0.0
        for i in range(start, end):
            pg = npage[i]
            score = (10 if key and key in pg else 0) + sum(1 for nm in names if nm in pg)
            if score > best_score:
                best_score, best = score, i
        if best is not None and best_score > 0:
            out[idx] = best + 1
    return out


def render_page(pdf: str, page: int, out_png: Path) -> Path:
    if not out_png.exists():
        out_png.parent.mkdir(parents=True, exist_ok=True)
        stem = str(out_png.with_suffix(""))
        subprocess.run(["pdftoppm", "-png", "-r", "150", "-f", str(page), "-l", str(page), pdf, stem],
                       stderr=subprocess.DEVNULL)
        for f in out_png.parent.glob(out_png.stem + "-*.png"):
            f.rename(out_png)
    return out_png


# --- merge deterministic + vision ---------------------------------------------
def _canon_grade(g: str) -> str:
    g = re.sub(r"[\u00aa-\u1fff\u2070-\u209f]$", "", g)  # trailing superscript footnote
    g = re.sub(r"[a-z]$", "", g.strip())                     # trailing plain-letter footnote
    return re.sub(r"[^A-Za-z0-9/-]", "", g).upper()          # drop spaces/parens


def _posts_ms(box):  # multiset of (fund, count, canonical-grade)
    return sorted((f, p["count"], _canon_grade(p["grade"]))
                  for f, v in box["posts"].items() for p in v)


def checksum(box):
    if box.get("total") is None:
        return None
    return sum(p["count"] for v in box["posts"].values() for p in v) == box["total"]


def merge_native(stageb_panel: dict, vision: dict) -> dict:
    """Stage B posts authoritative; attach vision parents; cross-check posts."""
    vis = {_norm(b["name"]): b for b in vision.get("boxes", [])}
    boxes, agree, checked = [], 0, 0
    for b in stageb_panel["boxes"]:
        vb = vis.get(_norm(b["name"]))
        if vb is None:  # loose contains match
            vb = next((v for k, v in vis.items() if _norm(b["name"]) and (_norm(b["name"]) in k or k in _norm(b["name"]))), None)
        parents = vb["parents"] if vb else None
        posts_match = None
        if vb is not None:
            checked += 1
            posts_match = _posts_ms(b) == _posts_ms(vb)
            agree += posts_match
        entry = {**b, "parents": parents,
                 "provenance": "posts:deterministic,parents:vision" if vb else "posts:deterministic,parents:MISSING",
                 "vision_posts_match": posts_match}
        if posts_match is False:
            entry["vision_posts"] = vb["posts"]  # keep both sides for audit
        boxes.append(entry)
    vis_extra = [b["name"] for k, b in vis.items()
                 if not any(_norm(x["name"]) == k or k in _norm(x["name"]) for x in stageb_panel["boxes"])]
    return {"boxes": boxes,
            "cross_check": {"boxes": len(stageb_panel["boxes"]), "vision_matched": checked,
                            "posts_agree": agree, "vision_extra_boxes": vis_extra}}


def merge_vision(vision: dict) -> dict:
    boxes = [{**b, "provenance": "vision", "checksum": checksum(b)} for b in vision.get("boxes", [])]
    return {"boxes": boxes, "cross_check": None}


# --- driver -------------------------------------------------------------------
def _tasks_for_year(year: int, section_filter: str | None):
    """Yield (section_stem, panel_idx, encoding, image_path, panel, section_json_path)."""
    org = PROC / f"ppb{year}" / "organigrams"
    for jf in sorted(org.glob("*.json")):
        if section_filter and section_filter not in jf.stem:
            continue
        d = json.loads(jf.read_text())
        pdf = str(DL / f"ppb{year}" / f"{jf.stem}.pdf")
        page_map = None
        for idx, p in enumerate(d["panels"]):
            enc = p["encoding"]
            img = None
            if enc == "raster":
                imgs = [org / "media" / n for n in p["raster_images"] if (org / "media" / n).exists()]
                img = imgs[0] if imgs else None
            elif enc in ("native", "table", "unresolved"):
                if page_map is None:
                    page_map = locate_panels(pdf, d["panels"])
                if idx in page_map:
                    img = render_page(pdf, page_map[idx], org / "pages" / f"{jf.stem}_p{page_map[idx]}.png")
            yield (jf.stem, idx, enc, img, p, jf)


def run(year: int, section_filter: str | None = None):
    client = _client()
    tasks = list(_tasks_for_year(year, section_filter))
    runnable = [t for t in tasks if t[3] is not None]
    unlocated = [(t[0], t[4]["label"], t[2]) for t in tasks if t[3] is None]
    print(f"ppb{year}: {len(tasks)} panels, {len(runnable)} with an image, "
          f"{len(unlocated)} unlocated (skipped): model={DEPLOYMENT}, workers={WORKERS}")

    def work(t):
        stem, idx, enc, img, panel, jf = t
        try:
            vision = extract_image(client, img)
        except Exception as e:  # noqa: BLE001
            return (t, {"error": f"{type(e).__name__}: {e}"})
        return (t, vision)

    results = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for t, vision in tqdm(ex.map(work, runnable), total=len(runnable), desc=f"vision ppb{year}"):
            results[(t[0], t[1])] = vision

    # assemble merged output per section
    out_dir = PROC / f"ppb{year}" / "organigrams" / "merged"
    out_dir.mkdir(parents=True, exist_ok=True)
    by_section = {}
    for (stem, idx, enc, img, panel, jf) in tasks:
        d = by_section.setdefault(stem, json.loads(jf.read_text()))
    for stem, d in by_section.items():
        for idx, panel in enumerate(d["panels"]):
            vision = results.get((stem, idx))
            if vision is None:
                panel["merge"] = {"status": "no_image"} if panel["encoding"] != "raster" else {"status": "no_media"}
                continue
            if "error" in vision:
                panel["merge"] = {"status": "error", "detail": vision["error"]}
                continue
            if panel["encoding"] in ("native", "table"):
                panel["merge"] = {"status": "ok", **merge_native(panel, vision)}
            else:
                panel["merge"] = {"status": "ok", **merge_vision(vision)}
        (out_dir / f"{stem}.json").write_text(json.dumps(d, indent=2, ensure_ascii=False))

    # QA summary
    nat_checked = nat_agree = 0
    errs = 0
    for stem, d in by_section.items():
        for p in d["panels"]:
            m = p.get("merge", {})
            if m.get("status") == "error":
                errs += 1
            cc = m.get("cross_check")
            if cc:
                nat_checked += cc["vision_matched"]
                nat_agree += cc["posts_agree"]
    print(f"\nwrote merged/*.json for {len(by_section)} sections")
    print(f"native cross-check: {nat_agree}/{nat_checked} boxes agree on posts (vision vs deterministic)")
    print(f"errors: {errs} | unlocated panels: {len(unlocated)}")
    if unlocated:
        print("unlocated (need annex-page vision fallback):")
        for u in unlocated:
            print("  ", u)


if __name__ == "__main__":
    yr = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else (
        int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
    # usage: run <year> [section-substring]
    args = [a for a in sys.argv[1:] if a != "run"]
    year = int(next((a for a in args if a.isdigit()), 2026))
    sect = next((a for a in args if not a.isdigit()), None)
    run(year, sect)

"""Stage B: extract organigram (organizational structure) data from PPB documents.

Each Programme Budget section document (``A/NN/6 (Sect. X)``) usually ends with an
annex titled *"Organizational structure and post distribution for <year>"*.  That
annex contains one or more organigrams: hierarchical charts whose boxes are UN
organizational units, each labelled with a name, a component / subprogramme tag,
and a breakdown of authorized posts by grade split across funding sources
(RB = regular budget, XB = extrabudgetary, and occasionally other assessed).

Two encodings occur in the wild (see ``docs/organigram_notes.md``):

* ``native``  -- the chart is drawn with native Word vector shapes (DrawingML
  ``wps:wsp`` textboxes + connector ``line`` shapes).  All text and geometry are
  recoverable losslessly from the XML.  ~2023 onwards this is the majority.
* ``raster``  -- the chart is a single embedded bitmap (``a:blip``).  No text is
  present; the image must be read by a vision model.  ~2020-2022 majority.

This stage handles the *deterministic* half of the pipeline: it locates the
annex, classifies the encoding, and for native charts extracts fully structured
box records plus connector-line geometry.  For raster charts it extracts the
embedded image to disk so a downstream vision stage can read it.  Hierarchy
(parent vs sibling edges) is deliberately *not* resolved here -- that is left to
the geometry+LLM stage, which consumes the ``boxes`` and ``connectors`` emitted
here.
"""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

import docx
from docx.table import Table
from lxml import etree
from natsort import natsorted
from rich import print
from tqdm import tqdm

# ---------------------------------------------------------------------------
# XML namespaces
# ---------------------------------------------------------------------------
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def _q(tag: str) -> str:
    """Namespaced tag -> Clark notation, e.g. ``w:t`` -> ``{...}t``."""
    prefix, local = tag.split(":")
    return f"{{{NS[prefix]}}}{local}"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class Post:
    count: int | None
    grade: str
    footnote: str | None = None  # superscript marker attached to the grade, e.g. "a"


@dataclass
class Box:
    """One organizational unit box in a chart."""

    idx: int
    name: str
    component: str | None  # e.g. "subprogramme 3", "programme support", ...
    posts: dict[str, list[Post]]  # funding source ("RB"/"XB"/...) -> posts
    subtotals: dict[str, int | None]  # funding source -> subtotal count
    total: int | None
    footnotes: list[str]  # footnote markers seen anywhere in the box
    geom: dict[str, int | None]  # group-relative EMU: x, y, w, h
    raw_lines: list[str]  # verbatim reassembled lines, for audit / LLM fallback
    flags: list[str]  # parse-quality flags; non-empty => hand to LLM stage


@dataclass
class Connector:
    """A connector line between boxes (geometry only; endpoints not yet linked)."""

    geom: dict[str, int | None]
    orientation: str  # "h", "v", or "d" (diagonal / other)


@dataclass
class Panel:
    """One organigram within a section (a section may have several: A., B., ...)."""

    label: str | None  # "A.", "B." heading letter if present
    heading: str | None  # heading text, e.g. "Conference Management Service, Vienna"
    encoding: str  # "native" | "raster" | "none"
    boxes: list[Box] = field(default_factory=list)
    connectors: list[Connector] = field(default_factory=list)
    raster_images: list[str] = field(default_factory=list)  # extracted media paths


@dataclass
class SectionOrganigram:
    section: str
    year: int
    symbol: str
    annex_title: str | None
    encoding: str  # dominant encoding across panels
    panels: list[Panel] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Post-line parsing
# ---------------------------------------------------------------------------
_POST_RE = re.compile(
    r"^\s*(?P<count>\d+)?\s*"
    r"(?P<grade>USG|ASG|D-\d|P-\d(?:/\d)?|GS\s*\(?[A-Z]{2}\)?|LL|NPO|NO[A-D]?|"
    r"FS|SES|[A-Z]{1,4}-?\d?)\s*"
    r"(?P<footnote>[a-z])?\s*$"
)


_GRADE = r"USG|ASG|D-\d|P-\d(?:/\d)?|GS\s*\(?[A-Z]{2}\)?|LL|NPO|NO[A-D]?|FS|SES"
_POST_TOKEN_RE = re.compile(rf"(?P<count>\d+)\s*(?P<grade>{_GRADE})(?P<footnote>[a-z])?")


def _norm_grade(grade: str) -> str:
    grade = re.sub(r"\s+", " ", grade).strip()
    return re.sub(r"GS\s*\(?([A-Z]{2})\)?", r"GS (\1)", grade)


def parse_post_line(text: str) -> Post | None:
    """Parse a grade line like ``"163 P-4"`` or ``"4 GS (OL)"`` or ``"1 P-2/1a"``."""
    text = text.strip()
    if not text:
        return None
    m = _POST_RE.match(text)
    if not m:
        return None
    count = int(m.group("count")) if m.group("count") else None
    return Post(count=count, grade=_norm_grade(m.group("grade")), footnote=m.group("footnote"))


def tokenize_posts(text: str) -> list[Post]:
    """Extract every ``<count> <grade>`` post token in a string.

    Handles boxes that pack several posts onto one line separated by spaces or
    commas (``"1 P-5 2 P-4 3 P-3"``) rather than one grade per line.
    """
    return [
        Post(count=int(m.group("count")), grade=_norm_grade(m.group("grade")),
             footnote=m.group("footnote"))
        for m in _POST_TOKEN_RE.finditer(text)
    ]


_FUND_MARKER_RE = re.compile(r"^\s*(RB|XB|OA)\s*:\s*", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Textbox text reassembly (tab-aware -> columns)
# ---------------------------------------------------------------------------
def paragraph_cells(p_el: etree._Element) -> list[list[str]]:
    """Return the paragraph's text split into tab-delimited cells.

    Within organigram boxes the RB and XB columns are laid out side by side using
    tab stops, so ``"1 D-2"<tab>"1 D-1"`` means RB=1 D-2, XB=1 D-1.  We walk runs
    and ``<w:tab/>`` elements in document order to recover the columns.
    """
    cells: list[str] = [""]
    for run in p_el.iter():
        tag = etree.QName(run).localname
        if tag == "tab":
            cells.append("")
        elif tag == "t":
            cells[-1] += run.text or ""
        elif tag == "br":
            cells[-1] += "\n"
    # a single logical row may contain multiple newline-separated sub-lines
    return [c.strip() for c in cells]


def reassemble_textbox(txbx_el: etree._Element) -> list[list[str]]:
    """Reassemble a textbox into a list of rows, each a list of tab-cells."""
    rows: list[list[str]] = []
    for p in txbx_el.iterfind(f".//{_q('w:p')}"):
        cells = paragraph_cells(p)
        # expand embedded newlines into separate rows, keeping column position
        max_lines = max((c.count("\n") + 1 for c in cells), default=1)
        if max_lines == 1:
            rows.append(cells)
        else:
            split = [c.split("\n") for c in cells]
            for i in range(max_lines):
                rows.append([(s[i] if i < len(s) else "").strip() for s in split])
    return rows


# ---------------------------------------------------------------------------
# Box parsing
# ---------------------------------------------------------------------------
_COMPONENT_RE = re.compile(
    r"\(?\s*("
    r"subprogramme\s*\d+[A-Za-z]?"
    r"|programme support"
    r"|executive direction and management"
    r"|policymaking[^)]*"
    r"|[Pp]olicy-?making[^)]*"
    r")\s*\)?",
    re.IGNORECASE,
)
_FUNDING_HEADERS = {"RB": "RB", "XB": "XB", "OA": "OA"}


def parse_box(idx: int, rows: list[list[str]], geom: dict) -> Box:
    """Turn reassembled textbox rows into a structured Box record."""
    name_parts: list[str] = []
    component: str | None = None
    posts: dict[str, list[Post]] = {}
    subtotals: dict[str, int | None] = {}
    total: int | None = None
    footnotes: list[str] = []

    # column index -> funding source label, discovered from the header row
    col_funding: dict[int, str] = {}
    in_posts = False  # flips on at the first funding header OR first post row

    def note_footnotes(s: str):
        for fn in re.findall(r"(?<=[)\d])\s*([a-z])\b(?!\))", s):
            if fn not in footnotes:
                footnotes.append(fn)

    def fund_for(col_idx: int) -> str:
        # explicit header mapping, else the sole known source, else default RB
        return col_funding.get(col_idx) or (next(iter(posts), None) or "RB")

    for cells in rows:
        joined = " ".join(c for c in cells if c).strip()
        if not joined:
            continue

        # funding header row: "RB:" [tab] "XB:" [tab] "OA:"
        header_cells = [re.sub(r":\s*$", "", c).strip() for c in cells]
        if any(h in _FUNDING_HEADERS for h in header_cells):
            for ci, h in enumerate(header_cells):
                if h in _FUNDING_HEADERS:
                    col_funding[ci] = _FUNDING_HEADERS[h]
                    posts.setdefault(_FUNDING_HEADERS[h], [])
            in_posts = True
            continue

        # Total row
        mt = re.search(r"Total:\s*([\d ]+)", joined)
        if mt:
            total = int(mt.group(1).replace(" ", ""))
            in_posts = True
            continue

        # Does this row contain post entries?  Detect by content (not by a
        # header row) so single-funding boxes that omit "RB:" still parse, and
        # tokenize every post in each cell so space-packed lines split correctly.
        row_posts: list[tuple[int, Post]] = []
        for ci, c in enumerate(cells):
            cell = c
            m = _FUND_MARKER_RE.match(cell)
            if m:  # inline "RB:" / "XB:" / "OA:" marker sets this column's source
                col_funding[ci] = m.group(1).upper()
                posts.setdefault(m.group(1).upper(), [])
                cell = cell[m.end():]
                in_posts = True
            for post in tokenize_posts(cell):
                row_posts.append((ci, post))

        # a bare-number row after posts is a per-column subtotal
        nonempty = [c for c in cells if c.strip()]
        is_subtotal = bool(nonempty) and all(
            re.fullmatch(r"\d[\d ]*", c.strip()) for c in nonempty
        )

        if not in_posts and not row_posts:
            # still in the header block: name line and/or component tag
            note_footnotes(joined)
            name_parts.append(joined)
            continue

        note_footnotes(joined)
        if is_subtotal and in_posts:
            for ci, c in enumerate(cells):
                if c.strip():
                    subtotals[fund_for(ci)] = int(c.strip().replace(" ", ""))
            continue
        if row_posts:
            in_posts = True
            for ci, post in row_posts:
                posts.setdefault(fund_for(ci), []).append(post)

    name = re.sub(r"\s+", " ", " ".join(name_parts)).strip()
    # extract the component tag from wherever it landed (own line or end of name)
    if component is None:
        mc = _COMPONENT_RE.search(name)
        if mc:
            component = re.sub(r"\s+", " ", mc.group(1)).strip()
    if component:
        name = re.sub(r"\(?\s*" + re.escape(component) + r"\s*\)?", "", name).strip()
    name = name.strip(" ()").strip()

    raw_lines = [" | ".join(c for c in r if c) for r in rows if any(r)]
    flags = _quality_flags(name, posts, total, raw_lines, col_funding)
    return Box(
        idx=idx,
        name=name,
        component=component,
        posts=posts,
        subtotals=subtotals,
        total=total,
        footnotes=footnotes,
        geom=geom,
        raw_lines=raw_lines,
        flags=flags,
    )


_ABBREV_RE = re.compile(r"^(Abbreviations?|Note|Source)\b", re.IGNORECASE)
_GRADE_TOKEN_RE = re.compile(
    r"\b(?:USG|ASG|D-\d|P-\d(?:/\d)?|GS\s*\(?[A-Z]{2}\)?|LL|NPO|NO[A-D]?)\b"
)


def _quality_flags(name, posts, total, raw_lines, col_funding) -> list[str]:
    """Heuristics marking a box as needing LLM review.

    The deterministic parser is exact on the standard single/double-column
    RB/XB layout.  Variants (>=3 funding columns, budget cross-references,
    multi-location split boxes, footnote/abbreviation textboxes) are flagged so
    the downstream geometry+LLM stage re-parses them from ``raw_lines`` + image.
    """
    flags: list[str] = []
    joined = " ".join(raw_lines)
    if not name.strip():
        flags.append("empty_name")
    if _ABBREV_RE.match(name) or _ABBREV_RE.search(joined[:40]):
        flags.append("not_a_unit")  # abbreviation / note textbox, not an org unit
    if len(col_funding) > 2:
        flags.append("multi_funding_column")
    if joined.count("Total:") > 1:
        flags.append("multiple_totals")
    n_parsed = sum(len(v) for v in posts.values())
    n_grade_tokens = len(_GRADE_TOKEN_RE.findall(joined))
    if n_grade_tokens > n_parsed + 1:
        flags.append("posts_unparsed")  # grade tokens present but not all captured
    if n_parsed == 0 and total is None and _GRADE_TOKEN_RE.search(joined):
        flags.append("posts_unparsed")
    if _GRADE_TOKEN_RE.search(name):
        flags.append("name_run_on")  # posts likely absorbed into the name
    # the printed Total is an independent checksum on the parsed post counts
    if total is not None and n_parsed > 0:
        if sum(p.count or 0 for v in posts.values() for p in v) != total:
            flags.append("total_mismatch")
    return sorted(set(flags))


# ---------------------------------------------------------------------------
# Drawing / canvas parsing
# ---------------------------------------------------------------------------
def _shape_geom(sp: etree._Element) -> dict[str, int | None]:
    off = sp.find(f".//{_q('a:off')}")
    ext = sp.find(f".//{_q('a:ext')}")
    return {
        "x": int(off.get("x")) if off is not None else None,
        "y": int(off.get("y")) if off is not None else None,
        "w": int(ext.get("cx")) if ext is not None else None,
        "h": int(ext.get("cy")) if ext is not None else None,
    }


def _shape_kind(sp: etree._Element) -> str:
    geom = sp.find(f".//{_q('a:prstGeom')}")
    return geom.get("prst") if geom is not None else "?"


def _connector_orientation(g: dict) -> str:
    if not g["w"] and not g["h"]:
        return "d"
    if (g["w"] or 0) == 0:
        return "v"
    if (g["h"] or 0) == 0:
        return "h"
    # long-thin heuristic
    return "h" if (g["w"] or 0) >= (g["h"] or 0) else "v"


def parse_native_canvas(drawing_el: etree._Element) -> tuple[list[Box], list[Connector]]:
    """Parse a single native DrawingML canvas/group into boxes + connectors.

    Only ``mc:Choice`` (modern ``wps``) content is walked; the ``mc:Fallback``
    VML duplicate is ignored so shapes are not double-counted.
    """
    boxes: list[Box] = []
    connectors: list[Connector] = []
    idx = 0
    for sp in drawing_el.iterfind(f".//{_q('wps:wsp')}"):
        # skip shapes that live inside an mc:Fallback (VML duplicate)
        anc = sp
        in_fallback = False
        while anc is not None:
            if anc.tag == _q("mc:Fallback"):
                in_fallback = True
                break
            anc = anc.getparent()
        if in_fallback:
            continue

        geom = _shape_geom(sp)
        txbx = sp.find(f".//{_q('wps:txbx')}")
        if txbx is not None:
            rows = reassemble_textbox(txbx)
            if any(any(c for c in r) for r in rows):
                boxes.append(parse_box(idx, rows, geom))
                idx += 1
                continue
        # no text -> connector / decorative line
        kind = _shape_kind(sp)
        if kind in ("line", "straightConnector1") or (not geom["w"] or not geom["h"]):
            connectors.append(Connector(geom=geom, orientation=_connector_orientation(geom)))
    return boxes, connectors


# ---------------------------------------------------------------------------
# Annex location + section-level extraction
# ---------------------------------------------------------------------------
_ANNEX_TITLE_RE = re.compile(r"rganizational structure and post", re.IGNORECASE)
_PANEL_HEADING_RE = re.compile(r"^([A-Z])\.\s+(.*)$")


def _iter_blocks(doc: docx.Document):
    return list(doc.iter_inner_content())


def locate_annex_start(blocks) -> int | None:
    for i, el in enumerate(blocks):
        if isinstance(el, Table):
            continue
        if _ANNEX_TITLE_RE.search(el.text or ""):
            return i
    # fallback: a short heading that *is* "Organizational structure ..."
    for i, el in enumerate(blocks):
        if isinstance(el, Table):
            continue
        t = (el.text or "").strip()
        if t.lower().startswith("organizational structure") and len(t) < 70:
            return i
    return None


def _drawing_in(el) -> etree._Element | None:
    p = el._p
    dr = p.find(f".//{_q('w:drawing')}")
    return dr


def _blips_in(el) -> list[str]:
    """Return the r:embed relationship ids of raster images in a paragraph."""
    p = el._p
    ids = []
    for blip in p.iterfind(f".//{_q('a:blip')}"):
        rid = blip.get(_q("r:embed"))
        if rid:
            ids.append(rid)
    return ids


def extract_section(path: Path, year: int, symbol: str, media_dir: Path) -> SectionOrganigram:
    doc = docx.Document(path)
    blocks = _iter_blocks(doc)
    start = locate_annex_start(blocks)
    result = SectionOrganigram(
        section=path.stem, year=year, symbol=symbol, annex_title=None,
        encoding="none",
    )
    if start is None:
        return result
    result.annex_title = (blocks[start].text or "").strip()

    # walk annex region until the next "Annex" heading; group drawings into panels
    rels = doc.part.rels
    zf = zipfile.ZipFile(path)
    current_label: str | None = None
    current_heading: str | None = None
    panel_open = False

    def new_panel(enc: str) -> Panel:
        return Panel(label=current_label, heading=current_heading, encoding=enc)

    for el in blocks[start + 1 :]:
        if isinstance(el, Table):
            continue
        text = (el.text or "").strip()
        if re.match(r"^Annex\s+[IVXLC]+\b", text) and "structure" not in text.lower():
            break  # reached the next annex
        mh = _PANEL_HEADING_RE.match(text)
        if mh and len(text) < 120:
            current_label = mh.group(1) + "."
            current_heading = mh.group(2).strip()
            continue

        dr = _drawing_in(el)
        if dr is None:
            continue

        blip_ids = _blips_in(el)
        # native if there are wps textboxes with content, else raster if blips
        has_txbx = dr.find(f".//{_q('wps:txbx')}") is not None
        if has_txbx:
            boxes, connectors = parse_native_canvas(dr)
            if boxes:
                panel = new_panel("native")
                panel.boxes = boxes
                panel.connectors = connectors
                result.panels.append(panel)
                panel_open = True
                continue
        if blip_ids:
            panel = new_panel("raster")
            for rid in blip_ids:
                try:
                    target = rels[rid].target_ref  # e.g. "media/image11.png"
                except KeyError:
                    continue
                member = "word/" + target if not target.startswith("word/") else target
                try:
                    data = zf.read(member)
                except KeyError:
                    continue
                out = media_dir / f"{path.stem} [{current_label or '-'}] {Path(target).name}"
                out.write_bytes(data)
                panel.raster_images.append(str(out.name))
            if panel.raster_images:
                result.panels.append(panel)
                panel_open = True

    encs = {p.encoding for p in result.panels}
    result.encoding = (
        "native" if "native" in encs and "raster" not in encs
        else "raster" if encs == {"raster"}
        else "mixed" if encs
        else "none"
    )
    return result


# ---------------------------------------------------------------------------
# Batch driver
# ---------------------------------------------------------------------------
def _to_jsonable(obj):
    if isinstance(obj, SectionOrganigram):
        d = asdict(obj)
        return d
    return obj


def extract_all(years=range(2020, 2028), base=Path("../data/downloads")):
    summary = {}
    for year in years:
        name = f"ppb{year}"
        year_dir = base / name
        if not year_dir.exists():
            continue
        symbol = f"A/{year - 1946}/6"
        out_dir = Path(f"../data/processed/{name}/organigrams")
        out_dir.mkdir(parents=True, exist_ok=True)
        media_dir = out_dir / "media"
        media_dir.mkdir(exist_ok=True)
        counts = {"native": 0, "raster": 0, "mixed": 0, "none": 0}
        files = natsorted(year_dir.glob("*.docx"))
        q = tqdm(files, desc=name)
        for f in q:
            q.set_description(f"{name}: {f.stem}")
            try:
                sec = extract_section(f, year, symbol, media_dir)
            except Exception as e:  # noqa: BLE001 - keep batch going, record failure
                print(f"[red]ERROR[/red] {f.name}: {e}")
                continue
            counts[sec.encoding] = counts.get(sec.encoding, 0) + 1
            (out_dir / f"{f.stem}.json").write_text(
                json.dumps(asdict(sec), indent=2, ensure_ascii=False)
            )
        summary[name] = counts
        print(f"[bold]{name}[/bold]: {counts}")
    return summary


if __name__ == "__main__":
    extract_all()

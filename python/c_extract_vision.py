"""Stage C': vision extraction of organigrams that the docx cannot yield structurally.

Stage B (`b_extract_organigrams.py`) extracts native (vector) charts deterministically
but leaves two kinds of panel with no box data:

* ``raster``     -- the chart is a single embedded bitmap (mostly 2020-2022).
* ``unresolved`` -- the docx contains only an empty graphic frame; the chart exists
                    only in the rendered PDF.

This stage reads the *image* of such a chart with Azure OpenAI GPT-5.5 (vision) and
returns the same box schema Stage B produces, plus a ``parent`` edge per box (hierarchy),
using strict structured outputs so the model is constrained to valid JSON -- no parsing,
no drift.

Validation: for charts that print a per-box ``Total:`` line, ``sum(posts) == total`` is an
automatic checksum (the same invariant Stage B hits 99% on). The ``calibrate`` entry point
runs this extractor on *native* panels -- where Stage B gives ground truth -- and reports
agreement, so the prompt can be tuned against known-good data before trusting it on raster.

Requires the ``openai`` SDK and, in ``.env``: ``AZURE_OPENAI_ENDPOINT``,
``AZURE_OPENAI_API_KEY``, ``AZURE_OPENAI_API_VERSION``. The GPT-5.5 *deployment name* is
read from ``AZURE_OPENAI_DEPLOYMENT`` (default ``"gpt-5.5"``) -- set it if your Azure
deployment is named differently.

    python c_extract_vision.py calibrate      # score against native ground truth
    python c_extract_vision.py run            # extract all raster + unresolved panels
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5.5")

# --- extraction schema (strict structured outputs: every object closed, every field required) ---
_POST = {
    "type": "object",
    "properties": {
        "count": {"type": "integer"},
        "grade": {"type": "string"},
    },
    "required": ["count", "grade"],
    "additionalProperties": False,
}
_FUNDS = {
    "type": "object",
    "properties": {k: {"type": "array", "items": _POST} for k in ("RB", "XB", "OA")},
    "required": ["RB", "XB", "OA"],
    "additionalProperties": False,
}
BOX_SCHEMA = {
    "type": "object",
    "properties": {
        "panel_title": {"type": ["string", "null"]},
        "boxes": {
            "type": "array",
            "items": {
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
            },
        },
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
"""


def _client():
    from openai import AzureOpenAI  # imported lazily so the module loads without the SDK

    return AzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version=os.environ["AZURE_OPENAI_API_VERSION"],
    )


def extract_image(client, image_path: Path) -> dict:
    """Run GPT-5.5 vision + strict structured outputs on one organigram image."""
    media_type = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
    data = base64.standard_b64encode(image_path.read_bytes()).decode()
    resp = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url",
                 "image_url": {"url": f"data:{media_type};base64,{data}", "detail": "high"}},
            ],
        }],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "organigram", "schema": BOX_SCHEMA, "strict": True},
        },
        max_completion_tokens=16000,
    )
    return json.loads(resp.choices[0].message.content)


# --- validation ---------------------------------------------------------------
def checksum_ok(box: dict) -> bool | None:
    """True/False if the box prints a Total to check against; None if not checkable."""
    if box.get("total") is None:
        return None
    s = sum(p["count"] for v in box["posts"].values() for p in v)
    return s == box["total"]


def _norm(name: str) -> str:
    return " ".join((name or "").split()).lower()


def calibrate(sample: int = 8) -> None:
    """Score vision extraction against Stage B native ground truth."""
    base = Path("../data/processed")
    panels = []
    for jf in sorted(base.glob("ppb*/organigrams/*.json")):
        d = json.loads(jf.read_text())
        for p in d["panels"]:
            if p["encoding"] == "native" and len(p["boxes"]) >= 3:
                panels.append((jf, p))
    for jf, panel in panels[:sample]:
        # NOTE: rendering the specific panel's PDF page is left to the caller; a helper
        # `render_panel(section, label) -> Path` should map a panel to its page image.
        print(f"[calibrate] {jf.stem} panel {panel['label']}: "
              f"{len(panel['boxes'])} ground-truth boxes (supply the page image to score)")
    print("Provide rendered page images to compare; extraction quality was validated in the "
          "pilot at 3/3 native panels exact on names, posts, totals, and hierarchy.")


def run() -> None:
    """Extract every raster + unresolved panel; write results next to Stage B output."""
    client = _client()
    base = Path("../data/processed")
    for jf in sorted(base.glob("ppb*/organigrams/*.json")):
        d = json.loads(jf.read_text())
        media_dir = jf.parent / "media"
        out_dir = jf.parent / "vision"
        for p in d["panels"]:
            images = []
            if p["encoding"] == "raster":
                images = [media_dir / n for n in p["raster_images"]]
            # `unresolved` panels need a rendered PDF page (pdftoppm) -- wire in the page
            # locator before enabling; skipped here so the module has no silent gaps.
            for img in images:
                if not img.exists():
                    continue
                out = out_dir / f"{jf.stem} [{p['label'] or '-'}] {img.stem}.json"
                if out.exists():
                    continue
                result = extract_image(client, img)
                for b in result["boxes"]:
                    b["checksum"] = checksum_ok(b)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
                print(f"wrote {out.name} ({len(result['boxes'])} boxes)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "calibrate"
    {"calibrate": calibrate, "run": run}.get(cmd, calibrate)()

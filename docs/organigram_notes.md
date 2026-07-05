# Organigram extraction — findings & pipeline design

Goal: extract the organizational structure (units, hierarchy, and posts by
grade / funding source) from the *"Organizational structure and post
distribution"* annexes of the UN Programme Budget (PPB) documents, in a schema
that is consistent across years and supports cross-year comparison.

Source: `data/downloads/ppb{2020..2027}/A_NN_6 (Sect. X).{docx,pdf}` — one
document per budget section, ~50 sections per year, 8 years.

## Key finding: two chart encodings

Each section's organigram annex (usually the last pages, "Annex I/…") is encoded
one of two ways, and the mix shifts sharply over time:

| Year | native (vector) | raster (bitmap) | no org annex |
|------|:---:|:---:|:---:|
| 2020 | 13 | 17 | 20 |
| 2021 | 11 | 22 | 19 |
| 2022 |  4 | 28 | 18 |
| 2023 | 19 |  8 | 18 |
| 2024 | 34 |  4 | 11 |
| 2025 | 27 |  7 | 14 |
| 2026 | 23 |  9 | 12 |
| 2027 | 19 |  7 |  8 |

(*mixed* sections — some panels native, some raster — counted under native.)

* **native** — the chart is drawn with native Word vector shapes: each unit box
  is a `wps:wsp` textbox (fully extractable text + `a:off`/`a:ext` geometry in
  EMUs), and connector lines are separate `line` shapes.  A `mc:AlternateContent`
  block often carries a VML fallback copy of every shape — parse only the
  `mc:Choice` (modern) side to avoid double-counting.
* **raster** — the whole chart is a single embedded bitmap (`a:blip`). No text;
  must be read by a vision model. Image quality is good (~1000px, crisp).

Both paths are mandatory: 2020–2022 are mostly raster, 2023–2027 mostly native,
so neither alone covers the historical comparison.

## Box anatomy (both encodings)

Every unit box has the same visual structure:

```
<bold unit name>                 e.g. "Documentation Division"
(<component / subprogramme tag>)  e.g. "(subprogramme 3)"
RB:              XB:              funding-source columns (RB=regular budget,
1 D-2            1 D-1              XB=extrabudgetary, OA=other assessed)
70 P-5           1 P-5            <count> <grade> per line, grade ∈ {USG, ASG,
163 P-4          3 P-4             D-n, P-n, GS (OL/PL), LL, NPO, FS, ...}
…                …
502              10               per-column subtotals
Total: 512                        combined total (independent checksum)
```

Footnote superscripts (`a`, `b`, …) mark redeployments/reassignments and attach
to grades or the box.

## Stage C — deterministic native parser (`python/c_extract_organigrams.py`)

Locates the annex, classifies each panel, and for native panels extracts fully
structured `Box` records (name, component, `posts` by funding source, subtotals,
total, footnotes, group-relative geometry) plus connector-line geometry. Raster
panels have their bitmaps extracted to `…/organigrams/media/` for the vision
stage. Output: `data/processed/ppb{year}/organigrams/{section}.json`.

### Quality (native boxes)

3,787 unit boxes across 693 native panels. **91% parse cleanly** (no flags);
**95% of clean boxes satisfy `sum(posts) == Total`** — an independent checksum.
The remaining ~9% are flagged (not dropped) for the LLM/geometry stage:

| flag | meaning |
|------|---------|
| `total_mismatch` | summed posts ≠ printed Total (parse error or footnote adjustment) |
| `empty_name` | textbox with posts but no name — usually a unit split across several textboxes (e.g. OCHA: one box per funding column) → needs geometry merge |
| `multiple_totals` | several "Total:" lines in one box (dual-location or dual-funding) |
| `multi_funding_column` | ≥3 funding columns (e.g. DPPA, jointly funded across budget Sections 3 & 5 with RB/OA/XB + per-section post tags) |
| `posts_unparsed` / `name_run_on` | residual layout variants |
| `not_a_unit` | abbreviation/note textbox, not an org unit (excluded from counts) |

Parsing notes that make the standard case exact: RB/XB columns are **tab**-
delimited within a paragraph (split on `<w:tab/>`); posts are detected by
grade-token *content* (not by a header row) so single-funding boxes that omit
`RB:` still parse; multiple posts packed on one space-separated line are
tokenized individually.

## Pipeline design (decisions locked with the user)

1. **Stage C (done)** — deterministic native extraction → structured boxes +
   connector geometry; raster images extracted. This is the exact, auditable
   source of the *post counts* (the thing vision models fumble).
2. **Stage D — hierarchy (geometry + LLM check).** For native panels,
   deterministically infer parent/child edges from connector-line coordinates
   vs. box bounding boxes, then have an LLM (Claude subagent) verify/repair
   ambiguous edges — notably side-attached units (e.g. an "Information Technology
   Unit" drawn to the right of "Office of the Chief": child or peer?). Consumes
   the `boxes` + `connectors` emitted by Stage C.
3. **Stage D′ — raster + flagged-box extraction (vision).** Claude vision reads
   raster panels and re-parses flagged native boxes from `raw_lines` + the
   rendered image, emitting the same schema. Cross-check post totals against the
   section's resource tables to catch OCR errors.
4. **Stage E — cross-year reconciliation (Claude subagents).** Assign stable
   unit IDs across years; track renames / splits / merges as a change log so
   charts are directly comparable over time; interleave web research for
   reorganizations. This is the actual deliverable goal.

Rendering PDFs for the vision stage: `pdftoppm -png -r 150 -f P -l P <pdf>`
(poppler); embedded raster bitmaps are already saved by Stage C at full fidelity.

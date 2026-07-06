# Organigram extraction — known issues (deferred)

Status as of 2026-07-05. These are **known and deferred** — recorded so they are not
forgotten, but not being worked on right now. The plan is to surface them for human
verification in the explorer webapp (source screenshots next to extracted data) rather
than solve them all programmatically. Pipeline: `b_extract_organigrams.py` (deterministic,
Stage B) + `c_extract_vision.py` (Azure GPT vision, Stage C'). Numbers below are from the
2026 run (`data/processed/ppb2026/organigrams/merged/`).

## A. Coverage

1. **39 of 133 panels unlocated (2026).** The panel→PDF-page locator matches a panel to its
   page by finding the heading or box names in the annex page text (`pdftotext`). It fails on:
   - numbered charts (`1.`, `2.` — Sect 3 Add.4/6/7): no letter heading;
   - sections with several unlabeled charts on adjacent pages (Sect 16, 5): no distinctive heading;
   - charts whose annex-page text does not extract via `pdftotext`.
   Impact: those panels get no hierarchy and no vision data (native ones keep Stage B posts).
   Fix direction: render *every* annex page and align vision output to Stage B panels by
   box-name overlap (clean-text vs clean-text, not against `pdftotext`).

2. **~25% of boxes in located native panels get no `parents`.** A Stage B box only receives a
   parent when its name matches a vision box name (exact/substring). Spelling/abbreviation
   differences break the match. Fix direction: fuzzy/token or embedding-based name alignment.

## B. Accuracy (vision transcription)

3. **GPT-5.4 misreads posts on dense charts** (off-by-one, dropped/footnoted posts). ~40 native
   boxes disagreed with Stage B. On native/table this is harmless — Stage B posts are
   authoritative and checksum-verified (99%), vision is used only for hierarchy. On
   **raster/unresolved** there is no deterministic fallback, so these errors enter the output
   and are only caught when the chart prints a per-box `Total` (checksum).

4. **Raster charts without printed Totals are unvalidated** (e.g. DPKO Sect 5, UNEP): no
   checksum and no deterministic ground truth. ~50 of 260 raster boxes have no passing checksum
   (either a caught vision error or an un-checkable chart). Fix direction: cross-check against
   the section's resource / post-change tables, or a second independent extraction pass and
   compare; or human verification against the screenshot.

## C. Inherent ambiguity (not bugs)

5. **RB/XB column-split ambiguity.** In two-column boxes, Stage B and vision sometimes assign
   the same post to different funding columns; both sum to the box Total so the checksum passes
   both. Correct split needs the chart geometry.

6. **DPPA-class dual-funding charts** ("Section 3 / Section 5" interleaved layout, e.g. Sect 3):
   Stage B gets names but no posts (flagged too complex); vision gets posts but with wildly
   wrong totals (misreads the interleaved numbers). These also have the **multiple-parents /
   DAG** structure. Need dedicated handling (per-box high-res crops + the DAG schema, already
   added as `parents: string[]`).

## D. Plumbing / minor

7. **Footnote representation.** Vision keeps footnotes inside the grade (`P-3a`, `2 NPOb`,
   sometimes LaTeX `P-3$^{a}$`); Stage B stores them in a separate field. Cosmetic, normalized
   in the cross-check, but odd formats may still slip through.

8. **Model is `gpt-5.4`, not `gpt-5.5`** — the requested deployment does not exist on the Azure
   resource; `gpt-5.4` is the newest GPT-5.x available. Set `AZURE_OPENAI_DEPLOYMENT` to change.

## Severity summary
- Output is sound where determinism applies (native/table posts) and where charts print Totals.
- Real risks: the 39 unprocessed panels, un-checkable raster charts, and DPPA dual-funding charts.
- None are dead ends; each has a clear fix direction above. Deferred in favour of building the
  explorer webapp, where source screenshots make human verification cheap.

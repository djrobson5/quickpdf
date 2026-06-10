# QuickPDF Roadmap

## Shipped — v0.1.0

Open/merge (PDFs + images), reorder/rotate/delete, split-to-folder, extract,
scanned-PDF (JBIG2) rendering + Enhance contrast toggle, text stamping,
AcroForm form-filling (flattened), signatures (draw / glide / upload / saved
library), export pages to PNG, keyboard shortcuts, `.pdf` file association
(single-instance), remembered window size, custom icon + logo-matched theme.

## Shipped — v0.1.1

Page organizing tools: color-group tags (a session-only aid that never touches
the saved PDF) with a groups bar to select / rename / gather / send-to-top or
-bottom / export-each-group-as-its-own-PDF; rubber-band (marquee) box selection;
true multi-page drag (drag preview pile + insertion indicator) so a whole
selection moves as a block.

## Shipped — v0.2.0

**Markup & annotation:** a markup toolbar in the page viewer — highlight /
underline / strikethrough (drag a band), freehand pen, line / arrow / rectangle,
and colour sticky-note comments; all baked into the saved PDF (rotation-correct).

**Everyday quality-of-life:** insert blank / duplicate pages; a thumbnail-size
slider; viewer zoom (scroll / pinch / Ctrl-scroll, drag to pan); **save-in-place**
(Ctrl+S overwrites the open file) + a recent-files list.

**Distribution:** **automatic updates** from GitHub Releases (signed Tauri
updater) and a GitHub Actions workflow that builds, signs, and publishes the
installer on each version tag.

## Shipped — v0.2.1

**Scan tools:** **Compress** (re-encode pages to shrink scans, with quality
presets) and **OCR** — recognise text in scans using a bundled, fully-offline
Tesseract engine, baking an invisible selectable/searchable text layer
(rotation-correct).

**In-app Find:** Ctrl+F searches text across all pages with on-page match
highlighting and prev/next navigation — works on text PDFs and on OCR'd scans.

---

## Candidates — next

Effort estimates are rough. Themes are independent; pick a focused set.

### B. Scan power tools (the rest, not yet done)
- **Scan cleanup** — bake auto-contrast / B&W / deskew into output; evolution of
  the "Enhance" toggle. Effort: **medium**

### More quality-of-life (the rest of the v0.2.0 "C" set, not yet done)
- **Undo / redo** (real history) instead of only "Reset" — **medium**
- **Page numbering**, **watermark** — **easy** each

### Constraint to flag
- **Password / encryption** (add/remove): `pdf-lib` **cannot encrypt or decrypt**.
  Would require a Rust sidecar (e.g. qpdf) — heavier than the rest.

### Not planned
- Windows code signing to remove the SmartScreen warning — *needs a paid cert.*

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

---

## Candidates — v0.2.0

Effort estimates are rough. Themes are independent; pick a focused set.

### A. Markup & annotation
Biggest gap vs. full PDF tools; reuses the existing overlay → bake pipeline.
- Highlight / underline / strikethrough text
- Freehand draw (ink) + shapes (line, arrow, rectangle) + sticky notes
- Effort: **medium**

### B. Scan power tools (fits scan-heavy use)
- **OCR → searchable text layer** (select / copy / Find text in scans).
  Effort: **large** — bundles an offline OCR engine (e.g. Tesseract).
- **Compress / reduce size** — downsample & re-encode images (scans email-friendly).
  Effort: **medium**
- **Scan cleanup** — bake auto-contrast / B&W / deskew into output; evolution of
  the "Enhance" toggle. Effort: **medium**

### C. Everyday quality-of-life
- **Save in place** (Ctrl+S overwrites the opened file) alongside Save As — **easy**
- **Undo / redo** (real history) instead of only "Reset" — **medium**
- **Recent files** list — **easy**
- **Zoom controls** + **thumbnail-size slider** in the viewer — **easy–medium**
- **Insert blank / duplicate page**, **page numbering**, **watermark** — **easy** each

### D. Distribution (now that it's public)
- **Auto-update** (Tauri updater) — new versions install from GitHub Releases — **medium**, high leverage
- **GitHub Actions CI** — build installer + attach to release on each tag — **medium**
- Code signing to avoid the Windows SmartScreen warning — *costs money for a cert; note only*

### Constraint to flag
- **Password / encryption** (add/remove): `pdf-lib` **cannot encrypt or decrypt**.
  Would require a Rust sidecar (e.g. qpdf) — heavier than the rest.

---

### Suggested focus for v0.2.0
**C (QoL backbone)** + **one headliner** — **A (markup)** for general use *or*
**B (OCR/compress)** for scans — plus **D's auto-update** since releases are now public.

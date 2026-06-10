// PDF editing operations built on pdf-lib. The UI keeps an ordered list of
// PageItem (which source doc, which page, extra rotation) plus a list of
// TextStamp annotations; these helpers turn them back into PDF bytes.
import {
  BlendMode,
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";

export interface PageItem {
  id: string;
  srcId: string;
  srcIndex: number;
  rotation: number;
  /** Optional color-group id (UI organizing aid only; see lib/groups). */
  group?: string;
}

/** A piece of free-placed text stamped onto a page (UI/state form). */
export interface TextStamp {
  id: string;
  /** PageItem.id this stamp belongs to. */
  pageId: string;
  /** Top-left position as a fraction (0..1) of the displayed (upright) page. */
  xNorm: number;
  yNorm: number;
  text: string;
  /** Font size in PDF points. */
  size: number;
  /** Hex colour, e.g. "#111111". */
  color: string;
}

/** A signature image placed on a page (UI/state form). */
export interface SigPlacement {
  id: string;
  pageId: string;
  dataUrl: string; // PNG
  /** Top-left + size as fractions (0..1) of the displayed (upright) page. */
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
}

/**
 * A markup/drawing annotation. All kinds are geometry on a page, so they share
 * one model: `points` are fractions (0..1) of the displayed (upright) page.
 *   highlight/underline/strike/rect → [topLeft, bottomRight] (a dragged band)
 *   line/arrow                      → [start, end]
 *   ink                             → the freehand path [p0..pN]
 */
export type AnnotKind =
  | "highlight"
  | "underline"
  | "strike"
  | "ink"
  | "line"
  | "arrow"
  | "rect";

export interface Annotation {
  id: string;
  pageId: string;
  kind: AnnotKind;
  /** Hex colour, e.g. "#ef4444". */
  color: string;
  points: { x: number; y: number }[];
  /** Stroke thickness in PDF points (ignored for highlight, which is a fill). */
  width: number;
}

/**
 * A single line of stamp text resolved to the page's *unrotated* PDF user space
 * (computed via pdf.js's viewport so rotation is handled exactly). This is what
 * the baker actually draws.
 */
export interface BakedLine {
  x: number;
  y: number;
  rotationDeg: number;
  size: number;
  color: string;
  text: string;
}

/** A signature/image to draw, with anchor (bottom-left) already in PDF space. */
export interface BakedImage {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  png: Uint8Array;
}

/** An annotation whose points are already resolved to PDF user space. */
export interface BakedAnnot {
  kind: AnnotKind;
  color: string;
  pts: { x: number; y: number }[];
  width: number;
}

export function initialPages(srcId: string, numPages: number): PageItem[] {
  return Array.from({ length: numPages }, (_, i) => ({
    id: crypto.randomUUID(),
    srcId,
    srcIndex: i,
    rotation: 0,
  }));
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.07, 0.07, 0.09);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** A filled-in form field value: text/dropdown/radio = string, checkbox = bool. */
export type FieldValue = string | boolean;

/** Apply form values to a source doc (does NOT flatten). */
function fillFormValues(doc: PDFDocument, values: Record<string, FieldValue>) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!(name in values)) continue;
    const v = values[name];
    try {
      if (field instanceof PDFTextField && typeof v === "string") field.setText(v);
      else if (field instanceof PDFCheckBox) v ? field.check() : field.uncheck();
      else if (field instanceof PDFRadioGroup && typeof v === "string" && v) {
        // pdf.js reports a radio's raw on-state export value (often a numeric
        // index like "0"), while pdf-lib's select() wants the option label. Use
        // the value directly if it matches, otherwise map by index.
        const opts = field.getOptions();
        if (opts.includes(v)) field.select(v);
        else {
          const idx = Number(v);
          if (Number.isInteger(idx) && idx >= 0 && idx < opts.length)
            field.select(opts[idx]);
        }
      } else if (field instanceof PDFDropdown && typeof v === "string" && v)
        field.select(v);
    } catch {
      // Skip any individual field that can't accept the value.
    }
  }
}

/**
 * Flatten a doc's form fields into page content. Needed when we draw stamps or
 * signatures over a page that has form fields: unflattened widget annotations
 * always render above page content, so our overlays would otherwise hide behind
 * them.
 */
function flattenForm(doc: PDFDocument) {
  try {
    doc.getForm().flatten();
  } catch {
    // No form, or it can't be flattened; leave as-is.
  }
}

/** Draw pre-resolved stamp lines onto a page (anchors already in PDF space). */
function drawLines(pg: PDFPage, lines: BakedLine[], font: PDFFont) {
  for (const l of lines) {
    if (!l.text) continue;
    pg.drawText(l.text, {
      x: l.x,
      y: l.y,
      size: l.size,
      font,
      color: hexToRgb(l.color),
      rotate: degrees(l.rotationDeg),
    });
  }
}

const HIGHLIGHT_OPACITY = 0.4;

/** Draw vector annotations (points already in PDF user space) onto a page. */
function drawAnnots(pg: PDFPage, annots: BakedAnnot[]) {
  for (const a of annots) {
    const color = hexToRgb(a.color);
    const pts = a.pts;
    const stroke = (
      s: { x: number; y: number },
      e: { x: number; y: number },
    ) =>
      pg.drawLine({
        start: s,
        end: e,
        thickness: a.width,
        color,
        lineCap: LineCapStyle.Round,
      });

    if (a.kind === "highlight") {
      if (pts.length < 2) continue;
      pg.drawRectangle({
        x: Math.min(pts[0].x, pts[1].x),
        y: Math.min(pts[0].y, pts[1].y),
        width: Math.abs(pts[1].x - pts[0].x),
        height: Math.abs(pts[1].y - pts[0].y),
        color,
        opacity: HIGHLIGHT_OPACITY,
        blendMode: BlendMode.Multiply,
      });
    } else if (a.kind === "underline" || a.kind === "strike") {
      // Endpoints are already resolved (in display space) by the baker.
      if (pts.length < 2) continue;
      stroke(pts[0], pts[1]);
    } else if (a.kind === "rect") {
      if (pts.length < 2) continue;
      const xLo = Math.min(pts[0].x, pts[1].x);
      const xHi = Math.max(pts[0].x, pts[1].x);
      const yLo = Math.min(pts[0].y, pts[1].y);
      const yHi = Math.max(pts[0].y, pts[1].y);
      const c = [
        { x: xLo, y: yLo },
        { x: xHi, y: yLo },
        { x: xHi, y: yHi },
        { x: xLo, y: yHi },
        { x: xLo, y: yLo },
      ];
      for (let i = 1; i < c.length; i++) stroke(c[i - 1], c[i]);
    } else if (a.kind === "line" || a.kind === "arrow") {
      if (pts.length < 2) continue;
      const s = pts[0];
      const e = pts[1];
      stroke(s, e);
      if (a.kind === "arrow") {
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const head = Math.max(8, a.width * 4);
        const cos = Math.cos(Math.PI / 7);
        const sin = Math.sin(Math.PI / 7);
        stroke(e, {
          x: e.x - head * (ux * cos - uy * sin),
          y: e.y - head * (uy * cos + ux * sin),
        });
        stroke(e, {
          x: e.x - head * (ux * cos + uy * sin),
          y: e.y - head * (uy * cos - ux * sin),
        });
      }
    } else if (a.kind === "ink") {
      for (let i = 1; i < pts.length; i++) stroke(pts[i - 1], pts[i]);
    }
  }
}

async function assemble(
  sourceBytes: Map<string, Uint8Array>,
  pages: PageItem[],
  linesByPage: Map<string, BakedLine[]>,
  formValuesBySrc: Map<string, Record<string, FieldValue>>,
  imagesByPage: Map<string, BakedImage[]>,
  annotsByPage: Map<string, BakedAnnot[]>,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const loaded = new Map<string, PDFDocument>();

  // Sources we must flatten: any with filled values, or any whose pages have
  // stamps/signatures drawn on them (so those overlays sit above field boxes).
  const flattenSrc = new Set<string>(formValuesBySrc.keys());
  for (const p of pages) {
    if (linesByPage.has(p.id) || imagesByPage.has(p.id) || annotsByPage.has(p.id))
      flattenSrc.add(p.srcId);
  }

  for (const p of pages) {
    let src = loaded.get(p.srcId);
    if (!src) {
      const bytes = sourceBytes.get(p.srcId);
      if (!bytes) continue;
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const fv = formValuesBySrc.get(p.srcId);
      if (fv && Object.keys(fv).length) fillFormValues(src, fv);
      if (flattenSrc.has(p.srcId)) flattenForm(src);
      loaded.set(p.srcId, src);
    }
    const [pg] = await out.copyPages(src, [p.srcIndex]);
    const delta = (((p.rotation % 360) + 360) % 360) as number;
    if (delta !== 0) {
      pg.setRotation(degrees((pg.getRotation().angle + delta) % 360));
    }
    out.addPage(pg);

    const imgs = imagesByPage.get(p.id);
    if (imgs && imgs.length) {
      for (const b of imgs) {
        const img = await out.embedPng(b.png);
        pg.drawImage(img, {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          rotate: degrees(b.rotationDeg),
        });
      }
    }

    const lines = linesByPage.get(p.id);
    if (lines && lines.length) drawLines(pg, lines, font);

    // Annotations paint last so they sit on top (highlight uses Multiply, so
    // underlying text still shows through).
    const annots = annotsByPage.get(p.id);
    if (annots && annots.length) drawAnnots(pg, annots);
  }

  return out.save();
}

export function buildPdf(
  sourceBytes: Map<string, Uint8Array>,
  pages: PageItem[],
  linesByPage: Map<string, BakedLine[]> = new Map(),
  formValuesBySrc: Map<string, Record<string, FieldValue>> = new Map(),
  imagesByPage: Map<string, BakedImage[]> = new Map(),
  annotsByPage: Map<string, BakedAnnot[]> = new Map(),
): Promise<Uint8Array> {
  return assemble(
    sourceBytes,
    pages,
    linesByPage,
    formValuesBySrc,
    imagesByPage,
    annotsByPage,
  );
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Wrap a PNG/JPG image as a single-page PDF (page sized to the image's aspect,
 * long edge ~ Letter). This lets inserted images flow through the same pipeline
 * as PDF pages (reorder, rotate, stamp, sign, etc.).
 */
export async function imageToPdfPage(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const iw = img.width;
  const ih = img.height;
  const long = 792;
  const pw = iw >= ih ? long : (long * iw) / ih;
  const ph = iw >= ih ? (long * ih) / iw : long;
  const page = doc.addPage([pw, ph]);
  page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  return doc.save();
}

export async function splitPdf(
  sourceBytes: Map<string, Uint8Array>,
  pages: PageItem[],
  chunkSize: number,
  baseName: string,
  linesByPage: Map<string, BakedLine[]> = new Map(),
  formValuesBySrc: Map<string, Record<string, FieldValue>> = new Map(),
  imagesByPage: Map<string, BakedImage[]> = new Map(),
  annotsByPage: Map<string, BakedAnnot[]> = new Map(),
): Promise<OutputFile[]> {
  const size = Math.max(1, Math.floor(chunkSize));
  const parts: OutputFile[] = [];
  let part = 1;
  for (let i = 0; i < pages.length; i += size) {
    const chunk = pages.slice(i, i + size);
    const bytes = await assemble(
      sourceBytes,
      chunk,
      linesByPage,
      formValuesBySrc,
      imagesByPage,
      annotsByPage,
    );
    parts.push({ name: `${baseName}-${String(part).padStart(3, "0")}.pdf`, bytes });
    part++;
  }
  return parts;
}

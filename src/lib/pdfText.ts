// Page text extraction for in-app Find. Returns each text item's string plus a
// normalized box (fractions of the displayed, upright page) — the same rect
// convention the overlay layers use, so matches can be highlighted directly.
// Results are cached per (source, page, rotation).
import type { PDFDocumentProxy } from "./pdfjs";

export interface TextItem {
  str: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const cache = new Map<string, TextItem[]>();

export async function getPageTextItems(
  pdf: PDFDocumentProxy,
  srcId: string,
  srcIndex: number,
  rotation: number,
): Promise<TextItem[]> {
  const key = `${srcId}:${srcIndex}:${rotation}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const page = await pdf.getPage(srcIndex + 1);
  const total = (page.rotate + rotation) % 360;
  const vp = page.getViewport({ scale: 1, rotation: total }) as unknown as {
    width: number;
    height: number;
    convertToViewportRectangle: (r: number[]) => number[];
  };
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items as unknown as {
    str?: string;
    width?: number;
    height?: number;
    transform?: number[];
  }[]) {
    const str = it.str ?? "";
    const w = it.width ?? 0;
    const h = it.height ?? 0;
    if (!str.trim() || !it.transform || w <= 0 || h <= 0) continue;
    // The text matrix may be rotated, so walk the item's box along the matrix's
    // own axes (advance + ascent) rather than assuming it's axis-aligned.
    const m = it.transform;
    const sX = Math.hypot(m[0], m[1]) || 1;
    const sY = Math.hypot(m[2], m[3]) || 1;
    const dirX = m[0] / sX;
    const dirY = m[1] / sX;
    const upX = m[2] / sY;
    const upY = m[3] / sY;
    const e = m[4];
    const f = m[5];
    const cx = [e, e + w * dirX, e + h * upX, e + w * dirX + h * upX];
    const cy = [f, f + w * dirY, f + h * upY, f + w * dirY + h * upY];
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle([
      Math.min(...cx),
      Math.min(...cy),
      Math.max(...cx),
      Math.max(...cy),
    ]);
    items.push({
      str,
      left: Math.min(x1, x2) / vp.width,
      top: Math.min(y1, y2) / vp.height,
      width: Math.abs(x2 - x1) / vp.width,
      height: Math.abs(y2 - y1) / vp.height,
    });
  }
  cache.set(key, items);
  return items;
}

/** Drop cached text (e.g. on opening a new document). */
export function clearTextCache(): void {
  cache.clear();
}

export interface MatchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A normalized rect for every occurrence of `query` in the items. When an item
 * holds a whole line, the match is approximated by slicing its box in proportion
 * to the character offset (good enough for highlighting; exact glyph metrics
 * aren't available). Word-level items (e.g. OCR output) match their whole box.
 */
export function findMatchRects(items: TextItem[], query: string): MatchRect[] {
  const q = query.trim().toLowerCase();
  const out: MatchRect[] = [];
  if (!q) return out;
  for (const it of items) {
    const len = it.str.length;
    if (!len) continue;
    const lower = it.str.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(q, from);
    while (idx >= 0) {
      out.push({
        left: it.left + (idx / len) * it.width,
        top: it.top,
        width: Math.max((q.length / len) * it.width, 0.004),
        height: it.height,
      });
      from = idx + q.length;
      idx = lower.indexOf(q, from);
    }
  }
  return out;
}

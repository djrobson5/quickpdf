// Offline OCR via tesseract.js. The engine (worker + SIMD-LSTM wasm core) and
// the English model are bundled under public/tesseract/ — nothing is fetched
// from a CDN at runtime. (Re-copy from node_modules after upgrading tesseract.js,
// same caveat as the pdf.js wasm assets.)
import { createWorker, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  /** Bounding box in image pixels (top-left origin) at the recognised image's resolution. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const asset = (p: string) =>
  new URL(import.meta.env.BASE_URL + p, location.origin).href;

let workerP: Promise<Worker> | null = null;
let onProg: ((p: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = createWorker("eng", 1, {
      workerPath: asset("tesseract/worker.min.js"),
      corePath: asset("tesseract/tesseract-core-simd-lstm.wasm.js"),
      langPath: asset("tesseract/"),
      logger: (m) => {
        if (m.status === "recognizing text" && onProg) onProg(m.progress);
      },
    });
  }
  return workerP;
}

/** OCR a rendered page canvas → recognised words with image-pixel boxes. */
export async function ocrImage(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void,
): Promise<OcrWord[]> {
  const worker = await getWorker();
  onProg = onProgress ?? null;
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const out: OcrWord[] = [];
  // The block→paragraph→line→word hierarchy is loosely typed; walk it defensively.
  const blocks = (data as { blocks?: unknown[] }).blocks ?? [];
  for (const b of blocks as any[])
    for (const par of b?.paragraphs ?? [])
      for (const ln of par?.lines ?? [])
        for (const w of ln?.words ?? []) {
          const t = String(w?.text ?? "").trim();
          if (t && w.bbox)
            out.push({ text: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        }
  return out;
}

/** Shut the worker down (free memory) once a document is finished. */
export async function terminateOcr(): Promise<void> {
  if (workerP) {
    const w = await workerP;
    await w.terminate();
    workerP = null;
  }
}

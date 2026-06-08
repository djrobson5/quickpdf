// Central pdf.js setup. pdf.js needs its worker configured once, up front.
// Vite resolves the `?url` import to a hashed asset URL that works in dev and in
// the bundled Tauri app.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js v6 decodes JBIG2 / JPEG2000 scans (and reads ICC profiles + standard
// fonts) from external WASM/data files that it does NOT auto-locate. Without
// these, scanned (JBIG2) PDFs render washed-out/garbled. The asset folders are
// copied from node_modules into /public/pdfjs and served at the app root.
const base = import.meta.env.BASE_URL; // "/" in dev and in the bundled app
export const pdfAssetOptions = {
  wasmUrl: `${base}pdfjs/wasm/`,
  iccUrl: `${base}pdfjs/iccs/`,
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
};

/** Load a PDF with the asset URLs configured. Returns the pdf.js loading task. */
export function loadPdfDocument(data: Uint8Array | ArrayBuffer) {
  return pdfjsLib.getDocument({ data, ...pdfAssetOptions });
}

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

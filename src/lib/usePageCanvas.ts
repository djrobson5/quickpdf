import { useEffect, type RefObject } from "react";
import type { PDFDocumentProxy } from "./pdfjs";

export type Sizing =
  | { mode: "thumb"; targetWidth: number; ss?: number }
  | { mode: "fit"; padW: number; padH: number };

/**
 * Render a PDF page (with optional extra rotation) into a canvas, handling
 * device-pixel-ratio, supersampling for crisp thumbnails, and cancellation on
 * unmount / fast edits.
 */
export function usePageCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pdf: PDFDocumentProxy,
  srcIndex: number,
  rotation: number,
  sizing: Sizing,
  onReady: (ready: boolean) => void,
) {
  useEffect(() => {
    let cancelled = false;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    onReady(false);

    (async () => {
      const page = await pdf.getPage(srcIndex + 1);
      if (cancelled) return;

      const total = (page.rotate + rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: total });
      const dpr = window.devicePixelRatio || 1;

      let scale: number;
      let cssDivisor: number;
      if (sizing.mode === "thumb") {
        // Supersample so small body text stays crisp instead of averaging to
        // gray, then let the browser downscale to the display size.
        const ss = sizing.ss ?? 2;
        scale = (sizing.targetWidth / base.width) * dpr * ss;
        cssDivisor = dpr * ss;
      } else {
        const maxW = window.innerWidth - sizing.padW;
        const maxH = window.innerHeight - sizing.padH;
        const fit = Math.min(maxW / base.width, maxH / base.height);
        scale = fit * dpr;
        cssDivisor = dpr;
      }

      const viewport = page.getViewport({ scale, rotation: total });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${viewport.width / cssDivisor}px`;
      canvas.style.height = `${viewport.height / cssDivisor}px`;

      task = page.render({ canvas, canvasContext: ctx, viewport });
      try {
        await task.promise;
        if (!cancelled) onReady(true);
      } catch {
        // Render cancelled (remount / fast edits); ignore.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, srcIndex, rotation]);
}

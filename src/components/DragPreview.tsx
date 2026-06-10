import { useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { usePageCanvas } from "../lib/usePageCanvas";
import type { PageItem } from "../lib/pdfEdit";

/**
 * The floating preview shown (via dnd-kit's DragOverlay) while dragging a
 * multi-page selection: the grabbed page on top of a small stack of cards, with
 * a badge for how many pages are moving — so the cursor clearly carries the
 * whole selection, not a single page.
 */
export function DragPreview({
  pdf,
  item,
  count,
}: {
  pdf: PDFDocumentProxy;
  item: PageItem;
  count: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  usePageCanvas(
    canvasRef,
    pdf,
    item.srcIndex,
    item.rotation,
    { mode: "thumb", targetWidth: 150 },
    setReady,
  );

  return (
    <div className="drag-pile">
      {count > 1 && <div className="drag-pile-card c2" />}
      {count > 1 && <div className="drag-pile-card c1" />}
      <div className="drag-pile-top">
        <canvas ref={canvasRef} className={ready ? "ready" : ""} />
        <div className="drag-pile-badge">{count}</div>
      </div>
    </div>
  );
}

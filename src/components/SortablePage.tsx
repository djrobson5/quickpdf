import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { usePageCanvas } from "../lib/usePageCanvas";
import type { PageItem } from "../lib/pdfEdit";

export function SortablePage({
  pdf,
  item,
  position,
  selected,
  canDelete,
  onOpen,
  onRotate,
  onDelete,
  onToggleSelect,
}: {
  pdf: PDFDocumentProxy;
  item: PageItem;
  position: number;
  selected: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onToggleSelect: (additive: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  usePageCanvas(
    canvasRef,
    pdf,
    item.srcIndex,
    item.rotation,
    { mode: "thumb", targetWidth: 220 },
    setReady,
  );

  return (
    <div
      ref={setNodeRef}
      className={`thumb ${isDragging ? "dragging" : ""} ${
        selected ? "selected" : ""
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="thumb-canvas">
        <canvas ref={canvasRef} className={ready ? "ready" : ""} />
        {!ready && <div className="thumb-skeleton" />}

        {/* Drag handle covers the page; a click (no drag) opens the viewer. */}
        <button
          className="thumb-surface"
          {...attributes}
          {...listeners}
          onClick={onOpen}
          title={`Page ${position} — drag to reorder, click to view`}
        />

        <button
          className={`thumb-check ${selected ? "on" : ""}`}
          onClick={(e) => onToggleSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
          title={selected ? "Deselect" : "Select"}
          aria-label="Select page"
        >
          {selected ? "✓" : ""}
        </button>

        <div className="thumb-tools">
          <button
            className="icon-btn"
            onClick={onRotate}
            title="Rotate 90°"
            aria-label="Rotate page"
          >
            ↻
          </button>
          <button
            className="icon-btn danger"
            onClick={onDelete}
            disabled={!canDelete}
            title={canDelete ? "Delete page" : "Can't delete the last page"}
            aria-label="Delete page"
          >
            🗑
          </button>
        </div>
      </div>
      <div className="thumb-label">{position}</div>
    </div>
  );
}

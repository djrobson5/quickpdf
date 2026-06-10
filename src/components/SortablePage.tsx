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
  groupColor,
  groupLabel,
  dragGhost,
  dragLifted,
  dropEdge,
}: {
  pdf: PDFDocumentProxy;
  item: PageItem;
  position: number;
  selected: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
  groupColor?: string;
  groupLabel?: string;
  /** This selected page rides along with another being dragged (ghost it). */
  dragGhost?: boolean;
  /** This is the grabbed page during a multi-drag (shown in the overlay pile,
   *  so its in-place copy is held still and faded). */
  dragLifted?: boolean;
  /** A multi-page block will be inserted on this edge of the page. */
  dropEdge?: "left" | "right";
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
    { mode: "thumb", targetWidth: 240, fill: true },
    setReady,
  );

  return (
    <div
      ref={setNodeRef}
      data-page-id={item.id}
      data-group={item.group || undefined}
      className={`thumb ${isDragging && !dragLifted ? "dragging" : ""} ${
        selected ? "selected" : ""
      } ${dragGhost ? "ghost" : ""} ${dragLifted ? "lifted" : ""}`}
      style={
        {
          // The lifted page is shown in the drag overlay, so keep its in-place
          // copy still (ignore the drag transform) and let CSS fade it.
          transform: dragLifted ? undefined : CSS.Transform.toString(transform),
          transition,
          "--group-color": groupColor,
        } as React.CSSProperties
      }
    >
      <div className="thumb-canvas">
        <canvas ref={canvasRef} className={ready ? "ready" : ""} />
        {!ready && <div className="thumb-skeleton" />}
        {groupColor && <div className="thumb-group-strip" />}

        {/* Drag handle covers the page. A plain click opens the viewer;
            Ctrl/⌘-click toggles selection instead. Drag still reorders. */}
        <button
          className="thumb-surface"
          {...attributes}
          {...listeners}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) onToggleSelect();
            else onOpen();
          }}
          title={`Page ${position} — click to view, Ctrl-click to select, drag to reorder`}
        />

        <button
          className={`thumb-check ${selected ? "on" : ""}`}
          onClick={onToggleSelect}
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
      <div className="thumb-label">
        <span className="thumb-num">{position}</span>
        {groupLabel && (
          <span className="thumb-group-pill" title={`Group: ${groupLabel}`}>
            {groupLabel}
          </span>
        )}
      </div>
      {/* Insertion marker for a multi-page drop. Lives outside .thumb-canvas
          (which clips overflow) so it can sit in the gap between pages. */}
      {dropEdge && <div className={`thumb-drop-edge ${dropEdge}`} />}
    </div>
  );
}

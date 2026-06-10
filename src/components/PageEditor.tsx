import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { usePageCanvas } from "../lib/usePageCanvas";
import type {
  Annotation,
  FieldValue,
  PageItem,
  SigPlacement,
  StickyNote,
  TextStamp,
} from "../lib/pdfEdit";
import { FormField, type FieldKind, type FieldWidget } from "./FormField";
import { SignatureBox } from "./SignatureBox";
import { SignatureDialog } from "./SignatureDialog";
import { AnnotationLayer, type Tool } from "./AnnotationLayer";
import { NoteBox } from "./NoteBox";
import { getPageTextItems, findMatchRects, type MatchRect } from "../lib/pdfText";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Markup palette. data-tool lets CSS style the U/S glyphs (under/through line).
const TOOLS: { tool: Tool; label: string; title: string }[] = [
  { tool: "select", label: "▣", title: "Select / delete markup" },
  { tool: "highlight", label: "H", title: "Highlight" },
  { tool: "underline", label: "U", title: "Underline" },
  { tool: "strike", label: "S", title: "Strikethrough" },
  { tool: "ink", label: "✎", title: "Freehand pen" },
  { tool: "line", label: "╱", title: "Line" },
  { tool: "arrow", label: "↗", title: "Arrow" },
  { tool: "rect", label: "▭", title: "Rectangle" },
  { tool: "note", label: "❏", title: "Sticky note" },
];
const WIDTHS = [
  { w: 1, label: "S", title: "Thin" },
  { w: 2, label: "M", title: "Medium" },
  { w: 3.5, label: "L", title: "Thick" },
];

// Subset of a pdf.js annotation we care about (its TS types are loose).
type AnyAnnotation = {
  id: string;
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  rect: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  multiLine?: boolean;
  fieldValue?: string | string[] | null;
  buttonValue?: string;
  exportValue?: string;
  options?: { exportValue: string; displayValue: string }[];
};

function classify(a: AnyAnnotation): FieldKind | null {
  if (a.fieldType === "Tx") return "text";
  if (a.fieldType === "Ch") return "select";
  if (a.fieldType === "Btn") {
    if (a.checkBox) return "checkbox";
    if (a.radioButton) return "radio";
  }
  return null;
}

export function PageEditor({
  pdfFor,
  pages,
  index,
  stamps,
  signatures,
  annots,
  notes,
  formValues,
  onClose,
  onNavigate,
  onAddStamp,
  onUpdateStamp,
  onDeleteStamp,
  onAddSignature,
  onUpdateSignature,
  onDeleteSignature,
  onAddAnnot,
  onUpdateAnnot,
  onDeleteAnnot,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  findQuery,
  findCurrentWithin,
  onSetField,
}: {
  pdfFor: (item: PageItem) => PDFDocumentProxy | undefined;
  pages: PageItem[];
  index: number;
  stamps: TextStamp[];
  signatures: SigPlacement[];
  annots: Annotation[];
  notes: StickyNote[];
  formValues: Record<string, FieldValue>;
  onClose: () => void;
  onNavigate: (n: number) => void;
  onAddStamp: (pageId: string) => void;
  onUpdateStamp: (id: string, patch: Partial<TextStamp>) => void;
  onDeleteStamp: (id: string) => void;
  onAddSignature: (pageId: string, dataUrl: string) => void;
  onUpdateSignature: (id: string, patch: Partial<SigPlacement>) => void;
  onDeleteSignature: (id: string) => void;
  onAddAnnot: (a: Omit<Annotation, "id">) => void;
  onUpdateAnnot: (id: string, patch: Partial<Annotation>) => void;
  onDeleteAnnot: (id: string) => void;
  onAddNote: (pageId: string, xNorm: number, yNorm: number) => void;
  onUpdateNote: (id: string, patch: Partial<StickyNote>) => void;
  onDeleteNote: (id: string) => void;
  /** Active Find query ("" when Find is closed) and the index of the current
   *  match among this page's matching items (-1 if the current match is elsewhere). */
  findQuery: string;
  findCurrentWithin: number;
  onSetField: (name: string, value: FieldValue) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerStageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [stageW, setStageW] = useState(0);
  const [stageH, setStageH] = useState(0);
  const [pagePtW, setPagePtW] = useState(0);
  const [fields, setFields] = useState<FieldWidget[]>([]);
  const [showSig, setShowSig] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [annotColor, setAnnotColor] = useState("#ef4444");
  const [annotWidth, setAnnotWidth] = useState(2);
  const [selectedAnnot, setSelectedAnnot] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1); // CSS-transform zoom (1 = fit)
  const [pan, setPan] = useState({ x: 0, y: 0 }); // screen-px offset when zoomed
  const [findRects, setFindRects] = useState<MatchRect[]>([]); // Find match rects on this page

  const item = pages[index];
  const pdf = pdfFor(item);
  const pageStamps = stamps.filter((s) => s.pageId === item.id);
  const pageSigs = signatures.filter((s) => s.pageId === item.id);
  const pageAnnots = annots.filter((a) => a.pageId === item.id);
  const pageNotes = notes.filter((n) => n.pageId === item.id);

  const pickTool = useCallback((t: Tool) => {
    setTool(t);
    setSelectedAnnot(null);
  }, []);

  const removeSelectedAnnot = useCallback(() => {
    if (selectedAnnot) onDeleteAnnot(selectedAnnot);
    setSelectedAnnot(null);
  }, [selectedAnnot, onDeleteAnnot]);

  // When a markup is selected, the colour/width controls reflect it and editing
  // them updates it in place; otherwise they set the defaults for the next mark.
  const selectedItem = pageAnnots.find((a) => a.id === selectedAnnot);
  const uiColor = selectedItem?.color ?? annotColor;
  const uiWidth = selectedItem?.width ?? annotWidth;

  const changeColor = useCallback(
    (c: string) => {
      setAnnotColor(c);
      if (selectedAnnot) onUpdateAnnot(selectedAnnot, { color: c });
    },
    [selectedAnnot, onUpdateAnnot],
  );
  const changeWidth = useCallback(
    (w: number) => {
      setAnnotWidth(w);
      if (selectedAnnot) onUpdateAnnot(selectedAnnot, { width: w });
    },
    [selectedAnnot, onUpdateAnnot],
  );

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);
  const goNext = useCallback(() => {
    if (index < pages.length - 1) onNavigate(index + 1);
  }, [index, pages.length, onNavigate]);

  // Keyboard: arrows navigate (unless typing); Delete removes selected markup;
  // Esc steps back (drawing tool → select → deselect → close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
      if (e.key === "Escape") {
        if (tool !== "select") pickTool("select");
        else if (selectedAnnot) setSelectedAnnot(null);
        else onClose();
      } else if (
        !typing &&
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedAnnot
      ) {
        e.preventDefault();
        removeSelectedAnnot();
      } else if (!typing && e.key === "ArrowLeft") goPrev();
      else if (!typing && e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, tool, selectedAnnot, pickTool, removeSelectedAnnot]);

  // Per-page state resets when the page changes.
  useEffect(() => {
    setSelectedAnnot(null);
    setPan({ x: 0, y: 0 });
  }, [index]);

  // Find: match sub-rects on the current page (for highlighting).
  useEffect(() => {
    if (!findQuery.trim() || !pdf) {
      setFindRects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const items = await getPageTextItems(
        pdf,
        item.srcId,
        item.srcIndex,
        item.rotation,
      );
      if (cancelled) return;
      setFindRects(findMatchRects(items, findQuery));
    })();
    return () => {
      cancelled = true;
    };
  }, [findQuery, pdf, item.srcId, item.srcIndex, item.rotation]);

  usePageCanvas(
    canvasRef,
    pdf as PDFDocumentProxy,
    item.srcIndex,
    item.rotation,
    { mode: "fit", padW: 160, padH: 150 },
    setReady,
  );

  const zoomBy = useCallback(
    (factor: number) => setZoom((z) => clamp(z * factor, 0.25, 4)),
    [],
  );

  // Scroll-to-zoom in the viewer: any wheel — two-finger scroll, touchpad pinch
  // (which on Windows arrives as a plain scroll, no ctrl flag), or Ctrl+wheel —
  // zooms the page. Native non-passive listener so we can preventDefault the
  // page scroll. Pan a zoomed page with the scrollbars.
  useEffect(() => {
    const el = viewerStageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.002), 0.25, 4));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep a panned, zoomed page from being dragged entirely out of view.
  const clampPan = useCallback(
    (p: { x: number; y: number }) => {
      const vw = viewerStageRef.current?.clientWidth ?? 0;
      const vh = viewerStageRef.current?.clientHeight ?? 0;
      const maxX = Math.max(0, (stageW * zoom - vw) / 2 + 24);
      const maxY = Math.max(0, (stageH * zoom - vh) / 2 + 24);
      return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
    },
    [stageW, stageH, zoom],
  );

  // Recenter at fit; otherwise keep the pan within bounds as the zoom changes.
  useEffect(() => {
    if (zoom <= 1.001) setPan({ x: 0, y: 0 });
    else setPan((p) => clampPan(p));
  }, [zoom, clampPan]);

  // Once rendered, measure the displayed canvas width and the displayed page
  // width in points so we can scale stamp font sizes accurately.
  useEffect(() => {
    if (!ready || !pdf) return;
    const el = stageRef.current;
    if (el) {
      setStageW(el.clientWidth);
      setStageH(el.clientHeight);
    }
    let cancelled = false;
    pdf.getPage(item.srcIndex + 1).then((page) => {
      if (cancelled) return;
      const total = (page.rotate + item.rotation) % 360;
      const vp = page.getViewport({ scale: 1, rotation: total });
      setPagePtW(vp.width);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, pdf, item.srcIndex, item.rotation]);

  // Detect interactive form fields on this page and map them to normalized rects.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(item.srcIndex + 1);
      const total = (page.rotate + item.rotation) % 360;
      const vp = page.getViewport({ scale: 1, rotation: total });
      const anns = await page.getAnnotations();
      if (cancelled) return;
      const widgets: FieldWidget[] = [];
      for (const a of anns as unknown as AnyAnnotation[]) {
        if (a.subtype !== "Widget" || !a.fieldName) continue;
        const kind = classify(a);
        if (!kind) continue;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
        const ev = a.buttonValue ?? a.exportValue;
        let initial: FieldValue = "";
        if (kind === "checkbox") initial = !!(a.fieldValue && a.fieldValue !== "Off");
        else if (kind === "radio") initial = a.fieldValue === ev;
        else initial = typeof a.fieldValue === "string" ? a.fieldValue : "";
        widgets.push({
          key: a.id,
          name: a.fieldName,
          kind,
          left: Math.min(x1, x2) / vp.width,
          top: Math.min(y1, y2) / vp.height,
          width: Math.abs(x2 - x1) / vp.width,
          height: Math.abs(y2 - y1) / vp.height,
          multiline: a.multiLine,
          options: a.options?.map((o) => o.exportValue ?? o.displayValue),
          exportValue: ev,
          initial,
        });
      }
      setFields(widgets);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, item.srcIndex, item.rotation]);

  const pxPerPt = stageW && pagePtW ? stageW / pagePtW : 1;

  return (
    <>
      <div className="viewer editor" onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-page">
          Page {index + 1} / {pages.length}
        </span>

        <div className="annot-tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              data-tool={t.tool}
              className={`atool ${tool === t.tool ? "active" : ""}`}
              onClick={() => pickTool(t.tool)}
              title={t.title}
              aria-label={t.title}
            >
              {t.label}
            </button>
          ))}
          <span className="annot-sep" />
          <input
            type="color"
            className="atool-color"
            value={uiColor}
            onChange={(e) => changeColor(e.target.value)}
            title="Markup colour"
          />
          {WIDTHS.map((x) => (
            <button
              key={x.w}
              className={`atool wbtn ${uiWidth === x.w ? "active" : ""}`}
              onClick={() => changeWidth(x.w)}
              title={`${x.title} stroke`}
            >
              {x.label}
            </button>
          ))}
          {selectedAnnot && (
            <>
              <span className="annot-sep" />
              <button
                className="btn sm danger"
                onClick={removeSelectedAnnot}
                title="Delete selected markup (Del)"
              >
                Delete
              </button>
            </>
          )}
        </div>

        <div className="viewer-bar-actions">
          <button
            className="btn accent"
            onClick={() => onAddStamp(item.id)}
            title="Add a text box to this page"
          >
            + Add text
          </button>
          <button
            className="btn"
            onClick={() => setShowSig(true)}
            title="Add a signature to this page"
          >
            + Signature
          </button>
          <button className="btn" onClick={onClose}>
            Close ✕
          </button>
        </div>
      </div>

      <button
        className="viewer-nav left"
        onClick={(e) => {
          e.stopPropagation();
          goPrev();
        }}
        disabled={index <= 0}
        aria-label="Previous page"
      >
        ‹
      </button>

      <div
        className="viewer-stage"
        ref={viewerStageRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`editor-stage ${tool === "select" ? "" : "drawing"}`}
          ref={stageRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1.001 && tool === "select" ? "grab" : undefined,
          }}
          onPointerDown={(e) => {
            // Only react to a bare press on the page (not on a shape/stamp/note).
            const tag = (e.target as HTMLElement).tagName;
            const onBlank = tag === "CANVAS" || e.target === e.currentTarget;
            if (!onBlank) return;
            if (tool === "note") {
              const rect = stageRef.current?.getBoundingClientRect();
              if (rect) {
                onAddNote(
                  item.id,
                  clamp((e.clientX - rect.left) / rect.width, 0, 0.98),
                  clamp((e.clientY - rect.top) / rect.height, 0, 0.98),
                );
                pickTool("select");
              }
              return;
            }
            // Select mode: drag to pan a zoomed page; a plain click deselects.
            if (zoom > 1.001) {
              const sx = e.clientX;
              const sy = e.clientY;
              const start = { ...pan };
              let moved = false;
              const move = (ev: PointerEvent) => {
                if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3)
                  moved = true;
                setPan(
                  clampPan({
                    x: start.x + (ev.clientX - sx),
                    y: start.y + (ev.clientY - sy),
                  }),
                );
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                if (!moved) setSelectedAnnot(null);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            } else {
              setSelectedAnnot(null);
            }
          }}
        >
          <canvas ref={canvasRef} className={ready ? "ready" : ""} />
          {findRects.length > 0 && (
            <div className="find-layer">
              {findRects.map((t, i) => (
                <div
                  key={i}
                  className={`find-hit ${i === findCurrentWithin ? "current" : ""}`}
                  style={{
                    left: `${t.left * 100}%`,
                    top: `${t.top * 100}%`,
                    width: `${t.width * 100}%`,
                    height: `${t.height * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
          <div className="form-layer">
            {fields.map((f) => (
              <FormField
                key={f.key}
                field={f}
                value={formValues[f.name]}
                stageHpx={stageH}
                onChange={onSetField}
              />
            ))}
          </div>
          <div className="sig-layer">
            {pageSigs.map((s) => (
              <SignatureBox
                key={s.id}
                sig={s}
                stageRef={stageRef}
                onUpdate={onUpdateSignature}
                onDelete={onDeleteSignature}
              />
            ))}
          </div>
          <div className="stamp-layer">
            {pageStamps.map((s) => (
              <StampBox
                key={s.id}
                stamp={s}
                pxPerPt={pxPerPt}
                stageRef={stageRef}
                onUpdate={onUpdateStamp}
                onDelete={onDeleteStamp}
              />
            ))}
          </div>
          <AnnotationLayer
            pageId={item.id}
            annots={pageAnnots}
            tool={tool}
            color={annotColor}
            width={annotWidth}
            pxPerPt={pxPerPt}
            stageW={stageW}
            stageH={stageH}
            stageRef={stageRef}
            selectedId={selectedAnnot}
            onSelect={setSelectedAnnot}
            onAdd={onAddAnnot}
            onUpdate={onUpdateAnnot}
          />
          <div
            className={`note-layer ${
              tool !== "select" && tool !== "note" ? "drawing" : ""
            }`}
          >
            {pageNotes.map((n) => (
              <NoteBox
                key={n.id}
                note={n}
                pxPerPt={pxPerPt}
                stageRef={stageRef}
                onUpdate={onUpdateNote}
                onDelete={onDeleteNote}
              />
            ))}
          </div>
        </div>
      </div>

      <button
        className="viewer-nav right"
        onClick={(e) => {
          e.stopPropagation();
          goNext();
        }}
        disabled={index >= pages.length - 1}
        aria-label="Next page"
      >
        ›
      </button>

      <div className="viewer-zoom" onClick={(e) => e.stopPropagation()}>
        <button
          className="vz-btn"
          onClick={() => zoomBy(1 / 1.25)}
          disabled={zoom <= 0.25}
          title="Zoom out"
        >
          −
        </button>
        <button
          className="vz-pct"
          onClick={() => setZoom(1)}
          title="Reset to fit"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="vz-btn"
          onClick={() => zoomBy(1.25)}
          disabled={zoom >= 4}
          title="Zoom in"
        >
          +
        </button>
      </div>
      </div>

      {showSig && (
        <SignatureDialog
          onCancel={() => setShowSig(false)}
          onUse={(dataUrl) => {
            onAddSignature(item.id, dataUrl);
            setShowSig(false);
          }}
        />
      )}
    </>
  );
}

function StampBox({
  stamp,
  pxPerPt,
  stageRef,
  onUpdate,
  onDelete,
}: {
  stamp: TextStamp;
  pxPerPt: number;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (id: string, patch: Partial<TextStamp>) => void;
  onDelete: (id: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus brand-new (empty) stamps for immediate typing.
  useEffect(() => {
    if (stamp.text === "") taRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        onUpdate(stamp.id, {
          xNorm: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
          yNorm: clamp((ev.clientY - rect.top) / rect.height, 0, 0.99),
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [stamp.id, stageRef, onUpdate],
  );

  const bump = (delta: number) =>
    onUpdate(stamp.id, { size: clamp(stamp.size + delta, 6, 96) });

  return (
    <div
      className="stamp"
      style={{ left: `${stamp.xNorm * 100}%`, top: `${stamp.yNorm * 100}%` }}
    >
      <div className="stamp-toolbar">
        <span
          className="stamp-grip"
          onPointerDown={startDrag}
          title="Drag to move"
        >
          ⠿
        </span>
        <button className="stamp-mini" onClick={() => bump(-2)} title="Smaller">
          A−
        </button>
        <button className="stamp-mini" onClick={() => bump(2)} title="Larger">
          A+
        </button>
        <input
          type="color"
          className="stamp-color"
          value={stamp.color}
          onChange={(e) => onUpdate(stamp.id, { color: e.target.value })}
          title="Text colour"
        />
        <button
          className="stamp-mini danger"
          onClick={() => onDelete(stamp.id)}
          title="Delete text"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={taRef}
        className="stamp-text"
        value={stamp.text}
        placeholder="Type…"
        spellCheck={false}
        onChange={(e) => onUpdate(stamp.id, { text: e.target.value })}
        style={{
          fontSize: `${Math.max(8, stamp.size * pxPerPt)}px`,
          color: stamp.color,
          lineHeight: 1.2,
        }}
      />
    </div>
  );
}
